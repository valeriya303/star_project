import { NavLink, Outlet } from "react-router-dom";
import Header from "./Header";
import "./Layout.css";

export default function Layout() 
{
  return (
    <div className="layout">
      <Header />
      <main className="layout__main">
        <Outlet />
      </main>
      <footer className="layout__footer">
        <NavLink to="/help" className="layout__link">
          Довідка та глосарій
        </NavLink>
        <NavLink to="/about-data" className="layout__link">
          Про дані
        </NavLink>
        <NavLink to="/privacy" className="layout__link">
          Політика конфіденційності
        </NavLink>
        <a href="/api/docs" target="_blank" rel="noreferrer">
          API (OpenAPI)
        </a>
        <span className="muted">
          <a
            href="https://www.cosmos.esa.int/web/hipparcos"
            target="_blank"
            rel="noreferrer"
            className="layout__link"
          >
            Каталог Hipparcos (ESA)
          </a>{" "}
          
        </span>
      </footer>
    </div>
  );
}
