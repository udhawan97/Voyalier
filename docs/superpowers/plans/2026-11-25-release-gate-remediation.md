# Voyalier release gate remediation

The owner selected the Windows source runner, dependency and SBOM fixes, and the remaining native acceptance from the implementation report. The base is `f3be0e243745208f433b01db35733d5949118574`. Push the accepted candidate to the existing production-readiness branch.

1. Admit the specific Cargo desktop test layout observed on Windows while preserving the existing deps path, exact test artifact checks, and activation diagnostics. Exercise acceptance and rejection paths and run the Windows desktop source job.
2. Remediate current Rust and production JavaScript advisory results with targeted, compatible updates. Document remaining informational findings and compatibility changes. Recheck locked dependency resolution, audits, migration and recovery tests.
3. Produce a repeatable standard dependency inventory covering Rust and JavaScript inputs and bind release inventories to actual artifacts. Record license coverage, data notices, and unknowns, and keep release inventory verification in the shared check entry point.
4. Run the source gates, refresh the graph, and repeat hosted checks on the pushed candidate. Exercise installed macOS and Windows paths with disposable profiles and synthetic fixtures where the environment supports them. Record platform, artifact, fixture, acceptance, and limitations separately. Preserve existing signed-update and vault recovery guarantees.
