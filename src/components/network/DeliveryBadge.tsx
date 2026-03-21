import { useTranslation } from "react-i18next";
import { RefreshCw } from "lucide-react";

interface DeliveryBadgeProps {
  state: string;
  onRetry?: () => void;
}

export default function DeliveryBadge({ state, onRetry }: DeliveryBadgeProps) {
  const { t } = useTranslation("network");
  switch (state) {
    case "sending":
      return (
        <span className="delivery-badge delivery-sending">
          <span className="delivery-spinner" /> {t("delivery.sending")}
        </span>
      );
    case "sent":
      return (
        <span className="delivery-badge delivery-sent">
          ✓ {t("delivery.sent")}
        </span>
      );
    case "delivered":
      return (
        <span className="delivery-badge delivery-delivered">
          ✓✓ {t("delivery.delivered")}
        </span>
      );
    case "failed":
      return (
        <span className="delivery-badge delivery-failed">
          ✗ {t("delivery.failed")}
          {onRetry && (
            <button className="delivery-retry-btn" onClick={onRetry} title={t("delivery.retryTitle")}>
              <RefreshCw size={12} />
            </button>
          )}
        </span>
      );
    case "queued":
      return (
        <span className="delivery-badge delivery-queued">
          📤 {t("delivery.queued")}
        </span>
      );
    default:
      return null;
  }
}
