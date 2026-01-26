import React from 'react';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    console.error("Uncaught error:", error, errorInfo);
    this.setState({ errorInfo });
  }

  handleReset = () => {
     window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      // You can render any custom fallback UI
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-900 text-white p-4">
          <div className="max-w-md w-full bg-gray-800 border border-gray-700 rounded-lg p-8 shadow-xl text-center">
            <h2 className="text-3xl font-bold text-red-500 mb-4">Oops!</h2>
            <p className="text-gray-300 mb-6">
              Something went wrong. We're sorry for the inconvenience.
            </p>
            {this.state.error && (
                <div className="bg-gray-900 p-4 rounded text-left overflow-auto max-h-40 mb-6 text-sm text-red-400 font-mono">
                    {this.state.error.toString()}
                </div>
            )}
            <button
              onClick={this.handleReset}
              className="bg-blue-600 hover:bg-blue-700 text-white font-bold py-2 px-6 rounded transition duration-200"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
