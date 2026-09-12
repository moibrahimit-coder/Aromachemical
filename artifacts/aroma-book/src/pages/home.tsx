import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { useLanguage } from "@/lib/i18n";
import { useGetBookSettings } from "@workspace/api-client-react";
import { ArrowRight, ArrowLeft, BookOpen, Search, FlaskConical, CheckCircle2 } from "lucide-react";

export default function Home() {
  const { t, language } = useLanguage();
  const { data: settings } = useGetBookSettings();

  const isAr = language === 'ar';
  const ArrowIcon = isAr ? ArrowLeft : ArrowRight;

  return (
    <div className="flex flex-col w-full pb-20">
      {/* Hero Section */}
      <section className="relative overflow-hidden pt-12 md:pt-24 pb-16">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="order-2 md:order-1 space-y-6 relative z-10 text-center md:text-start md:rtl:text-right">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-sm font-medium">
                <BookOpen className="w-4 h-4" />
                {t('hero.edition')}
              </div>
              <h1 className="text-4xl md:text-6xl font-bold tracking-tight text-foreground leading-[1.2]">
                <span className={isAr ? "font-arabic" : "font-serif italic"}>{t('hero.title')}</span>
              </h1>
              <p className="text-xl text-muted-foreground leading-relaxed max-w-lg mx-auto md:mx-0">
                {t('hero.subtitle')}
              </p>
              
              <div className="pt-4 pb-8 border-y border-border/50 my-6">
                <p className="text-lg italic text-primary/80 font-medium">
                  "{t('hero.author_quote')}"
                </p>
              </div>
              
              <div className="flex flex-col sm:flex-row items-center gap-4 pt-4">
                <Button asChild size="lg" className="w-full sm:w-auto h-12 px-8 text-lg rounded-full shadow-lg shadow-primary/20 group">
                  <Link href="/checkout">
                    {t('nav.buy_now')}
                    <ArrowIcon className="ml-2 rtl:mr-2 rtl:ml-0 w-5 h-5 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
                  </Link>
                </Button>
                <div className="flex flex-col items-center sm:items-start text-sm text-muted-foreground">
                  {settings?.price ? (
                    settings.offerAvailable && settings.offerPrice ? (
                      <>
                        <span className="text-sm line-through">{settings.price} {settings.currency.toUpperCase()}</span>
                        <span className="font-bold text-primary text-xl">
                          {t('buy.first_edition_offer')} {settings.offerPrice} {settings.currency.toUpperCase()}
                        </span>
                        <span>{t('buy.first_100_note')}</span>
                      </>
                    ) : (
                      <span className="font-bold text-foreground text-xl">
                        {settings.price} {settings.currency.toUpperCase()}
                      </span>
                    )
                  ) : (
                    <span className="font-bold text-primary text-lg">
                      {t('buy.price_coming')}
                    </span>
                  )}
                </div>
              </div>
            </div>
            
            <div className="order-1 md:order-2 relative mx-auto md:ml-auto md:mr-0 w-full max-w-sm">
              <div className="absolute inset-0 bg-primary/20 blur-3xl rounded-full scale-150 transform -translate-y-12 translate-x-8 z-0"></div>
              <img 
                src="/images/book.jpeg" 
                alt="Book Cover" 
                className="w-full h-auto rounded-r-2xl rounded-l-md shadow-2xl relative z-10 border border-border/50 transform md:rotate-2 hover:rotate-0 transition-transform duration-500"
              />
              {/* Decorative elements */}
              <div className="absolute -bottom-6 -left-6 w-24 h-24 bg-card border border-primary/20 rounded-full flex items-center justify-center shadow-xl z-20 animate-bounce" style={{animationDuration: '3s'}}>
                <FlaskConical className="w-10 h-10 text-primary" />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* About Section */}
      <section className="py-20 bg-muted/30 border-y border-border/40">
        <div className="container mx-auto px-4 max-w-4xl text-center space-y-8">
          <h2 className="text-3xl md:text-4xl font-bold">{t('about.title')}</h2>
          <div className="space-y-6 text-lg md:text-xl text-muted-foreground leading-relaxed">
            <p>{t('about.desc1')}</p>
            <p className="font-medium text-foreground">{t('about.desc2')}</p>
          </div>
        </div>
      </section>

      {/* Contents Section */}
      <section className="py-20">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('contents.title')}</h2>
            <div className="h-1 w-20 bg-primary mx-auto rounded-full"></div>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((num) => (
              <div key={num} className="flex items-start gap-4 p-6 rounded-2xl bg-card border border-border/50 shadow-sm hover:shadow-md transition-shadow">
                <div className="w-10 h-10 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <p className="text-lg font-medium pt-1">{t(`contents.i${num}`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Why Section */}
      <section className="py-20 bg-secondary text-secondary-foreground">
        <div className="container mx-auto px-4 max-w-6xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-center">
            <div className="relative aspect-square md:aspect-auto md:h-[500px] w-full rounded-2xl overflow-hidden shadow-2xl border border-primary/20 order-2 md:order-1">
              <img
                src={`${import.meta.env.BASE_URL}images/perfumery-lab.jpg`}
                alt={isAr ? "زجاجات زيوت عطرية وأدوات تركيب العطور مع الياسمين والبرغموت" : "Aromatic oil bottles and perfumery tools with jasmine and bergamot"}
                className="h-full w-full object-cover"
                loading="lazy"
              />
            </div>
            
            <div className="space-y-6 order-1 md:order-2">
              <h2 className="text-3xl md:text-4xl font-bold text-primary">{t('why.title')}</h2>
              <div className="space-y-6 text-lg leading-relaxed text-secondary-foreground/80">
                <p>{t('why.desc1')}</p>
                <p className="font-bold text-xl text-primary/90">{t('why.desc2')}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Audience Section */}
      <section className="py-20">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="text-center mb-16">
            <h2 className="text-3xl md:text-4xl font-bold mb-4">{t('audience.title')}</h2>
            <div className="h-1 w-20 bg-primary mx-auto rounded-full"></div>
          </div>
          
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-8">
            {[1, 2, 3, 4].map((num) => (
              <div key={num} className="p-8 rounded-2xl bg-card border border-border shadow-sm relative overflow-hidden group">
                <div className="absolute top-0 right-0 rtl:right-auto rtl:left-0 w-32 h-32 bg-primary/5 rounded-bl-full rtl:rounded-bl-none rtl:rounded-br-full -z-10 group-hover:scale-110 transition-transform"></div>
                <h3 className="text-xl font-bold mb-3 text-primary">{t(`audience.a${num}_title`)}</h3>
                <p className="text-muted-foreground leading-relaxed">{t(`audience.a${num}_desc`)}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Author Section */}
      <section className="py-20 bg-muted/50 border-t border-border/40">
        <div className="container mx-auto px-4 max-w-4xl">
          <div className="flex flex-col md:flex-row items-center gap-10">
            <div className="w-48 h-48 md:w-64 md:h-64 rounded-full overflow-hidden border-4 border-primary/20 shadow-xl shrink-0">
              <img src="/images/author.jpeg" alt={t('author.name')} className="w-full h-full object-cover" />
            </div>
            <div className="text-center md:text-start md:rtl:text-right space-y-4">
              <h2 className="text-sm uppercase tracking-widest text-primary font-bold">{t('author.title')}</h2>
              <h3 className="text-3xl font-bold">{t('author.name')}</h3>
              <p className="text-lg text-muted-foreground leading-relaxed">
                {t('author.bio')}
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-24 bg-card text-center border-t border-border">
        <div className="container mx-auto px-4 max-w-3xl space-y-8">
          <h2 className="text-3xl md:text-5xl font-bold">{t('buy.title')}</h2>
          <p className="text-xl text-muted-foreground">
            {t('hero.subtitle')}
          </p>
          {settings?.price && settings.offerPrice && (
            <p className="text-sm text-muted-foreground">
              {settings.offerAvailable
                ? `${t('buy.first_edition_offer')} ${settings.offerPrice} ${settings.currency.toUpperCase()} — ${t('buy.first_100_note')}`
                : `${t('buy.regular_price')} ${settings.price} ${settings.currency.toUpperCase()}`}
            </p>
          )}
          <div className="pt-8">
            <Button asChild size="lg" className="h-14 px-12 text-lg rounded-full shadow-lg shadow-primary/20 group">
              <Link href="/checkout">
                {t('buy.buy_btn')}
                <ArrowIcon className="ml-2 rtl:mr-2 rtl:ml-0 w-5 h-5 transition-transform group-hover:translate-x-1 rtl:group-hover:-translate-x-1" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
