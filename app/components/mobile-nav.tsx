import { useState, useCallback } from "react";
import { Link } from "react-router";

interface NavLink {
  label: string;
  href: string;
  external?: boolean;
}

export function MobileMenu({ links, activePath }: { links: NavLink[]; activePath?: string }) {
  const [open, setOpen] = useState(false);

  const toggle = useCallback(() => setOpen((o) => !o), []);

  return (
    <>
      {/* Hamburger button - md:hidden */}
      <button
        onClick={toggle}
        className="md:hidden p-2 -mr-2 rounded-md text-white/60 hover:text-white hover:bg-white/5 transition-colors"
        aria-label="Toggle menu"
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          {open ? (
            <path d="M6 18L18 6M6 6l12 12" />
          ) : (
            <path d="M4 6h16M4 12h16M4 18h16" />
          )}
        </svg>
      </button>

      {/* Dropdown overlay */}
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={toggle} />
          <nav className="absolute top-full left-0 right-0 z-50 bg-[#0a0a0a]/95 backdrop-blur-xl border-b border-white/5 md:hidden">
            <div className="max-w-[1440px] mx-auto px-4 py-2 flex flex-col">
              {links.map((link) =>
                link.href.startsWith("/") ? (
                  <Link
                    key={link.label}
                    to={link.href}
                    onClick={toggle}
                    className={`px-3 py-2.5 rounded-md text-sm transition-colors ${
                      link.href === activePath
                        ? "text-emerald-400 bg-emerald-500/10"
                        : "text-white/60 hover:text-white hover:bg-white/5"
                    }`}
                  >
                    {link.label}
                  </Link>
                ) : (
                  <a
                    key={link.label}
                    href={link.href}
                    target={link.external ? "_blank" : undefined}
                    rel={link.external ? "noopener noreferrer" : undefined}
                    onClick={toggle}
                    className="px-3 py-2.5 rounded-md text-sm text-white/60 hover:text-white hover:bg-white/5 transition-colors flex items-center gap-1"
                  >
                    {link.label}
                    {link.external && <span className="text-[10px]">↗</span>}
                  </a>
                )
              )}
            </div>
          </nav>
        </>
      )}
    </>
  );
}
