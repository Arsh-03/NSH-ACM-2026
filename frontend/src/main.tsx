import { createRoot } from "react-dom/client";
import App from "./app/App.tsx";
import "./styles/index.css";

const root = document.getElementById("root")!;
root.style.width = "100%";
root.style.height = "100%";
root.style.overflow = "auto";

createRoot(root).render(<App />);