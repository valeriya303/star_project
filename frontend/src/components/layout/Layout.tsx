import { Link, Outlet } from "react-router-dom";
import Header from "./Header";
import "./Layout.css";

export default function Layout() {
  return (
    <div className="layout">
      <Header />
      <main className="layout__main">
        <Outlet />
      </main>
      <footer className="layout__footer">
        <Link to="/help">Довідка та глосарій</Link>
        <Link to="/about-data">Про дані</Link>
        <Link to="/privacy">Політика конфіденційності</Link>
        <a href="/api/docs" target="_blank" rel="noreferrer">API (OpenAPI)</a>
        <span className="muted">Каталог Hipparcos (ESA) · лінії сузір'їв Stellarium</span>
      </footer>
    </div>
  );
}
