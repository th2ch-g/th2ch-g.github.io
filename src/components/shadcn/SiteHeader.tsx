import { useEffect, useRef, useState } from 'react';
import { Check, Languages, Menu, Moon, Search, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  active: boolean;
}

interface LocaleItem {
  code: string;
  label: string;
  href: string;
  active: boolean;
}

interface Props {
  homeHref: string;
  homeLabel: string;
  homeActive: boolean;
  icon?: string;
  navItems: NavItem[];
  localeItems: LocaleItem[];
  menuLabel: string;
  searchLabel: string;
  searchPlaceholder: string;
  themeLabel: string;
  languageLabel: string;
}

declare global {
  interface Window {
    PagefindUI?: new (options: Record<string, unknown>) => unknown;
    __th2chPagefindPromise?: Promise<void>;
  }
}

function loadPagefind(): Promise<void> {
  if (window.PagefindUI) return Promise.resolve();
  if (window.__th2chPagefindPromise) return window.__th2chPagefindPromise;

  window.__th2chPagefindPromise = new Promise<void>((resolve, reject) => {
    if (!document.querySelector('link[data-pagefind-css]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = '/pagefind/pagefind-ui.css';
      link.dataset.pagefindCss = '';
      document.head.appendChild(link);
    }

    const existing = document.querySelector<HTMLScriptElement>('script[data-pagefind-script]');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('Pagefind failed to load')), { once: true });
      return;
    }

    const script = document.createElement('script');
    script.src = '/pagefind/pagefind-ui.js';
    script.dataset.pagefindScript = '';
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error('Pagefind failed to load')), { once: true });
    document.head.appendChild(script);
  }).catch((error) => {
    window.__th2chPagefindPromise = undefined;
    throw error;
  });

  return window.__th2chPagefindPromise;
}

function ThemeButton({ label }: { label: string }) {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');

  useEffect(() => {
    setTheme(document.documentElement.dataset.theme === 'light' ? 'light' : 'dark');
  }, []);

  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    document.documentElement.classList.toggle('dark', next === 'dark');
    setTheme(next);
    try {
      localStorage.setItem('theme', next);
    } catch {
      // Persistence is optional when storage is unavailable.
    }
  };

  return (
    <Button type="button" variant="ghost" size="icon" className="theme-toggle" aria-label={label} title={label} onClick={toggle}>
      {theme === 'dark' ? <Sun aria-hidden="true" /> : <Moon aria-hidden="true" />}
    </Button>
  );
}

function SearchDialog({ label, placeholder }: { label: string; placeholder: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const initialized = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open || initialized.current) return;
    setError(false);
    loadPagefind()
      .then(() => {
        if (!window.PagefindUI || initialized.current) return;
        new window.PagefindUI({
          element: '#pagefind-search-shadcn',
          showSubResults: true,
          showImages: false,
          showFilters: true,
          translations: { placeholder },
        });
        initialized.current = true;
        window.setTimeout(() => {
          document.querySelector<HTMLInputElement>('#pagefind-search-shadcn input')?.focus();
        }, 0);
      })
      .catch(() => setError(true));
  }, [open, placeholder]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button data-search-open type="button" variant="outline" size="sm" aria-label={label} title={label} className="search-trigger gap-2 text-muted-foreground">
          <Search aria-hidden="true" />
          <span className="hidden sm:inline">{label}</span>
          <kbd className="ml-1 hidden rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px] md:inline">⌘K</kbd>
        </Button>
      </DialogTrigger>
      <DialogContent aria-describedby="shadcn-search-description">
        <DialogTitle className="pr-10 text-lg font-semibold tracking-tight">{label}</DialogTitle>
        <DialogDescription id="shadcn-search-description" className="sr-only">{placeholder}</DialogDescription>
        <div id="pagefind-search-shadcn" className="shadcn-pagefind" />
        {error && (
          <p className="m-0 rounded-md border border-border bg-muted p-3 text-sm text-muted-foreground">
            Search index unavailable. Run <code>npm run build</code> first.
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LocaleLinks({ items, label, compact = false }: { items: LocaleItem[]; label: string; compact?: boolean }) {
  return (
    <div className={cn('lang-switch flex items-center rounded-md border border-border bg-background/70 p-0.5', compact && 'w-full justify-stretch')} aria-label={label}>
      {items.map((item) => (
        <a
          key={item.code}
          href={item.href}
          hrefLang={item.code}
          lang="en"
          aria-current={item.active ? 'page' : undefined}
          className={cn(
            'pill shadcn-locale-link inline-flex min-h-7 items-center justify-center rounded px-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
            compact && 'flex-1',
            item.active && 'bg-primary text-primary-foreground shadow-sm hover:bg-primary hover:text-primary-foreground',
          )}
        >
          {item.active && compact && <Check className="mr-1 size-3" aria-hidden="true" />}
          {item.label}
        </a>
      ))}
    </div>
  );
}

export function SiteHeader(props: Props) {
  const [navigationOpen, setNavigationOpen] = useState(false);

  return (
    <header className="site-header shadcn-header sticky top-0 z-50 border-b border-border/80 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/72">
      <div className="inner mx-auto flex min-h-16 max-w-[var(--max-width)] items-center gap-2 px-4 sm:px-5">
        <a
          href={props.homeHref}
          aria-label={props.homeLabel}
          aria-current={props.homeActive ? 'page' : undefined}
          className="brand shadcn-brand group mr-2 inline-flex size-9 shrink-0 items-center justify-center rounded-full ring-1 ring-border transition-all hover:ring-primary/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {props.icon && <img src={props.icon} alt="" width={32} height={32} aria-hidden="true" className="size-8 rounded-full object-cover transition-transform group-hover:scale-105" />}
        </a>

        <nav className={cn(!navigationOpen && 'nav-list', 'hidden flex-1 items-center gap-1 md:flex')} aria-label="Primary">
          {props.navItems.map((item) => (
            <a
              key={item.href}
              href={item.href}
              aria-current={item.active ? 'page' : undefined}
              className={cn(
                'shadcn-nav-link relative rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground',
                item.active && 'bg-accent text-foreground after:absolute after:inset-x-3 after:-bottom-[13px] after:h-0.5 after:rounded-full after:bg-primary',
              )}
            >
              {item.label}
            </a>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-1.5">
          <SearchDialog label={props.searchLabel} placeholder={props.searchPlaceholder} />
          <ThemeButton label={props.themeLabel} />
          <div>
            <LocaleLinks items={props.localeItems} label={props.languageLabel} />
          </div>
          <Sheet open={navigationOpen} onOpenChange={setNavigationOpen}>
            <SheetTrigger asChild>
              <Button data-nav-toggle type="button" variant="ghost" size="icon" className="nav-toggle md:hidden" aria-label={props.menuLabel}>
                <Menu aria-hidden="true" />
              </Button>
            </SheetTrigger>
            <SheetContent>
              <SheetTitle className="flex items-center gap-2 pr-10 text-lg font-semibold">
                <Languages className="size-5 text-primary" aria-hidden="true" />
                {props.menuLabel}
              </SheetTitle>
              <nav className={cn(navigationOpen && 'nav-list', 'mt-8 flex flex-col gap-2')} aria-label="Primary">
                {props.navItems.map((item) => (
                  <SheetClose asChild key={item.href}>
                    <a
                      href={item.href}
                      aria-current={item.active ? 'page' : undefined}
                      className={cn(
                        'shadcn-nav-link rounded-lg border border-transparent px-4 py-3 text-base font-medium text-muted-foreground transition-colors hover:border-border hover:bg-accent hover:text-accent-foreground',
                        item.active && 'border-primary/25 bg-primary/10 text-primary',
                      )}
                    >
                      {item.label}
                    </a>
                  </SheetClose>
                ))}
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
