import type { AppError } from "@voyalier/contracts";

import { describeError } from "../app/format";
import { Banner } from "./Banner";
import { Button } from "./Button";
import { RetryIcon } from "./icons";

export function OfflineBanner({
  error,
  onRetry,
  retrying,
}: {
  error: AppError;
  onRetry: () => void;
  retrying?: boolean;
}) {
  const copy = describeError(error);
  return (
    <Banner
      tone="error"
      role="alert"
      title={copy.title}
      action={
        <Button
          variant="secondary"
          icon={<RetryIcon />}
          onClick={onRetry}
          busy={retrying}
        >
          Retry
        </Button>
      }
    >
      {copy.body}
    </Banner>
  );
}
