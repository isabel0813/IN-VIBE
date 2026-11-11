import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { isDesktop } from "./desktop/bridge";
import Widget from "./widget/Widget";

const widgetWindow =
  isDesktop() &&
  new URLSearchParams(location.search).get("window") === "widget";
if (widgetWindow) document.documentElement.classList.add("widget-page");

createRoot(document.getElementById("root")!).render(
  <StrictMode>{widgetWindow ? <Widget native /> : <App />}</StrictMode>,
);
