import { useApp } from "../../state/AppProvider";

export function Toast() {
  const { state } = useApp();
  return <div className={"toast" + (state.toast ? " on" : "")}>{state.toast}</div>;
}
