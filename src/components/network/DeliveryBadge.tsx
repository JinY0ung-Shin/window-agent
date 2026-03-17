import { RefreshCw } from "lucide-react";

interface DeliveryBadgeProps {
  state: string;
  onRetry?: () => void;
}

export default function DeliveryBadge({ state, onRetry }: DeliveryBadgeProps) {
  switch (state) {
    case "sending":
      return (
        <span className="delivery-badge delivery-sending">
          <span className="delivery-spinner" /> 전송 중...
        </span>
      );
    case "delivered":
      return (
        <span className="delivery-badge delivery-delivered">
          ✓ 전달됨
        </span>
      );
    case "failed":
      return (
        <span className="delivery-badge delivery-failed">
          ✗ 실패
          {onRetry && (
            <button className="delivery-retry-btn" onClick={onRetry} title="재시도">
              <RefreshCw size={12} />
            </button>
          )}
        </span>
      );
    case "queued":
      return (
        <span className="delivery-badge delivery-queued">
          📤 대기 중
        </span>
      );
    default:
      return null;
  }
}
