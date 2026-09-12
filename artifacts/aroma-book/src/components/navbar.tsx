import { Link, useLocation } from "wouter";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Show, useUser, useClerk } from "@clerk/react";
import { useGetBookMe, getGetBookMeQueryKey } from "@workspace/api-client-react";

export function Navbar() {
  const { language, setLanguage, t } = useLanguage();
  const { signOut } = useClerk();
  const [location] = useLocation();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: me } = useGetBookMe({ query: { enabled: true, queryKey: getGetBookMeQueryKey() } });

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-2">
            <span className="font-arabic font-bold text-xl tracking-tight text-primary">
              الاروما كيميكالز
            </span>
          </Link>
        </div>

        <div className="flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setLanguage(language === 'ar' ? 'en' : 'ar')}
            className="font-sans text-xs uppercase font-bold tracking-wider"
          >
            {language === 'ar' ? 'EN' : 'عربي'}
          </Button>

          <Show when="signed-out">
            <Link href="/sign-in" className="text-sm font-medium hover:text-primary transition-colors">
              {t('nav.sign_in')}
            </Link>
            <Button asChild size="sm" className="hidden sm:flex">
              <Link href="/checkout">
                {t('nav.buy_now')}
              </Link>
            </Button>
          </Show>

          <Show when="signed-in">
            <Link href="/user-portal" className="text-sm font-medium hover:text-primary transition-colors">
              {t('nav.my_books')}
            </Link>
            
            {me?.isAdmin && (
              <Link href="/admin" className="text-sm font-medium text-primary hover:opacity-80 transition-opacity">
                {t('nav.admin')}
              </Link>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => signOut({ redirectUrl: basePath || "/" })}
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              {t('nav.sign_out')}
            </Button>
          </Show>
        </div>
      </div>
    </nav>
  );
}
