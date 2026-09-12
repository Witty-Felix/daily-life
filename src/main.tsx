import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { CloudVirtueApp } from "./CloudVirtueApp";

const virtueApiUrl = import.meta.env.VITE_VIRTUE_API_URL as string | undefined;
const root = document.getElementById("root")!;
createRoot(root).render(
  <StrictMode>{virtueApiUrl ? <CloudVirtueApp baseUrl={virtueApiUrl} /> : <App />}</StrictMode>,
);
