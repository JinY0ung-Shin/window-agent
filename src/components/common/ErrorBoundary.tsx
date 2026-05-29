import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { i18n } from "../../i18n";

interface Props {
  children: ReactNode;
  fallbackClassName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className={`error-boundary-fallback ${this.props.fallbackClassName ?? ""}`}>
          <AlertCircle size={36} strokeWidth={1.5} />
          <p className="error-boundary-title">{i18n.t("common:errors.boundaryTitle")}</p>
          <p className="error-boundary-detail">{i18n.t("common:errors.boundaryDetail")}</p>
          {this.state.error?.message && (
            <details className="error-boundary-details">
              <summary>{i18n.t("common:errors.boundaryDetailsSummary")}</summary>
              <pre>{this.state.error.message}</pre>
            </details>
          )}
          <button className="btn-primary error-boundary-retry" onClick={this.handleReset}>
            <RefreshCw size={14} />
            {i18n.t("common:retry")}
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
