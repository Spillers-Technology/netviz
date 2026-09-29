import { Component, type ReactNode } from "react";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import ReportProblemOutlined from "@mui/icons-material/ReportProblemOutlined";
import { EmptyState } from "./EmptyState";

type State = { error?: Error };

// WorkspaceBoundary contains a rendering crash to one workspace, so the
// sidebar and every other workspace keep working.
export class WorkspaceBoundary extends Component<{ name: string; children: ReactNode }, State> {
  state: State = {};

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidUpdate(previous: { name: string }) {
    if (previous.name !== this.props.name && this.state.error) this.setState({ error: undefined });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <Box role="alert">
        <EmptyState
          icon={ReportProblemOutlined}
          title={`${this.props.name} stopped working`}
          action={
            <Box sx={{ display: "flex", gap: 1, justifyContent: "center" }}>
              <Button variant="contained" onClick={() => this.setState({ error: undefined })}>
                Try again
              </Button>
              <Button onClick={() => window.location.reload()}>Reload NetViz</Button>
            </Box>
          }
        >
          Something unexpected happened while drawing this page. Your scan results are still in memory.
          <Box component="pre" sx={{ mt: 1.5, fontSize: 12, whiteSpace: "pre-wrap", textAlign: "left" }}>
            {this.state.error.message}
          </Box>
        </EmptyState>
      </Box>
    );
  }
}
