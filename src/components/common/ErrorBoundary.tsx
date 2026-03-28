import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

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
          <p className="error-boundary-title">Something went wrong</p>
          <p className="error-boundary-detail">{this.state.error?.message}</p>
          <button className="btn-primary error-boundary-retry" onClick={this.handleReset}>
            <RefreshCw size={14} />
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
