//! Destination policy for traveler-requested web captures.
//!
//! Resource URLs are untrusted input. The policy checks both the textual URL
//! and the addresses returned by the resolver, and the resolver is consulted
//! again for every new request. Redirects are disabled for this capture class:
//! a redirect is an untrusted destination change, not permission to follow a
//! second request.

use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};

use ureq::unversioned::{
    resolver::{DefaultResolver, ResolvedSocketAddrs, Resolver},
    transport::DefaultConnector,
};

#[derive(Debug, Default)]
pub(crate) struct ResourceResolver;

impl Resolver for ResourceResolver {
    fn resolve(
        &self,
        uri: &ureq::http::Uri,
        config: &ureq::config::Config,
        timeout: ureq::unversioned::transport::NextTimeout,
    ) -> Result<ResolvedSocketAddrs, ureq::Error> {
        let resolved = DefaultResolver::default().resolve(uri, config, timeout)?;
        if resolved.iter().any(|address| !is_public_address(address)) {
            return Err(ureq::Error::HostNotFound);
        }
        Ok(resolved)
    }
}

pub(crate) fn resource_agent() -> ureq::Agent {
    let config = ureq::Agent::config_builder()
        .timeout_global(Some(std::time::Duration::from_secs(30)))
        .max_redirects(0)
        .max_redirects_will_error(true)
        .user_agent("Voyalier/0.1 (+https://github.com/udhawan97/Voyalier)")
        .build();
    ureq::Agent::with_parts(config, DefaultConnector::default(), ResourceResolver)
}

pub(crate) fn validate_resource_destination(raw: &str) -> Result<(), &'static str> {
    let url = url::Url::parse(raw).map_err(|_| "the saved link is not a valid web address")?;
    if !matches!(url.scheme(), "http" | "https") {
        return Err("only http and https links can be fetched");
    }
    if url.host_str().is_none() || !url.username().is_empty() || url.password().is_some() {
        return Err("the saved link must name a public site without credentials");
    }
    let host = url.host_str().unwrap_or_default();
    let host_for_ip = host.trim_matches(['[', ']']);
    // Integer, hexadecimal, and octal-looking authorities are ambiguous IP
    // spellings accepted by some stacks. Reject them before DNS gets involved.
    if host.bytes().all(|byte| byte.is_ascii_digit())
        || host.starts_with("0x")
        || host.starts_with("0X")
        || host.eq_ignore_ascii_case("localhost")
        || host.to_ascii_lowercase().ends_with(".localhost")
        || host.to_ascii_lowercase().ends_with(".local")
    {
        return Err("ambiguous numeric destinations are not allowed");
    }
    if let Ok(address) = host_for_ip.parse::<IpAddr>() {
        if !is_public_address(&SocketAddr::new(
            address,
            url.port_or_known_default().unwrap_or(80),
        )) {
            return Err("private or local destinations are not allowed");
        }
    }
    Ok(())
}

fn is_public_address(address: &SocketAddr) -> bool {
    match address.ip() {
        IpAddr::V4(ip) => is_public_v4(ip),
        IpAddr::V6(ip) => {
            if ip.segments()[..6] == [0, 0, 0, 0, 0, 0xffff] {
                let mapped = ip.to_ipv4().expect("IPv4-mapped address");
                is_public_v4(mapped)
            } else {
                is_public_v6(ip)
            }
        }
    }
}

fn is_public_v4(ip: Ipv4Addr) -> bool {
    !ip.is_loopback()
        && !ip.is_private()
        && !ip.is_link_local()
        && !ip.is_unspecified()
        && !ip.is_multicast()
        && !ip.is_broadcast()
        // RFC 6598 shared address space.
        && !(ip.octets()[0] == 100 && (64..=127).contains(&ip.octets()[1]))
        // RFC 5737 documentation ranges must not be treated as reachable data.
        && !(ip.octets()[0] == 192 && ip.octets()[1] == 0 && ip.octets()[2] == 2)
        && !(ip.octets()[0] == 198 && ip.octets()[1] == 51 && ip.octets()[2] == 100)
        && !(ip.octets()[0] == 203 && ip.octets()[1] == 0 && ip.octets()[2] == 113)
}

fn is_public_v6(ip: Ipv6Addr) -> bool {
    let segments = ip.segments();
    !ip.is_loopback()
        && !ip.is_unspecified()
        && !ip.is_multicast()
        // fc00::/7 unique-local and fe80::/10 link-local.
        && (segments[0] & 0xfe00) != 0xfc00
        && (segments[0] & 0xffc0) != 0xfe80
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_local_private_and_ambiguous_destinations() {
        for raw in [
            "http://127.0.0.1/",
            "http://localhost/",
            "http://[::1]/",
            "http://[::ffff:127.0.0.1]/",
            "http://10.0.0.1/",
            "http://[fd00::1]/",
            "http://2130706433/",
            "http://0x7f000001/",
        ] {
            assert!(validate_resource_destination(raw).is_err(), "{raw}");
        }
    }

    #[test]
    fn accepts_a_normal_public_host_and_rejects_credentials() {
        assert!(validate_resource_destination("https://example.com/guide").is_ok());
        assert!(validate_resource_destination("https://user:pass@example.com/guide").is_err());
    }

    #[test]
    fn resolver_rejects_private_addresses_even_when_dns_returns_a_mix() {
        assert!(!is_public_address(&"127.0.0.1:80".parse().unwrap()));
        assert!(!is_public_address(&"[::ffff:10.0.0.1]:80".parse().unwrap()));
        assert!(is_public_address(&"93.184.216.34:443".parse().unwrap()));
    }
}
