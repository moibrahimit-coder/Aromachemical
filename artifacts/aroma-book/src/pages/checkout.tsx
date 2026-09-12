import { useEffect, useState, useRef } from "react";
import { useLocation } from "wouter";
import { useLanguage } from "@/lib/i18n";
import { 
  useGetBookSettings, 
  useCreateBookOrder,
  useRequestBookUpload 
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { AlertCircle, UploadCloud, CreditCard, Smartphone, Banknote, Loader2 } from "lucide-react";

export default function Checkout() {
  const { t, language } = useLanguage();
  const [, setLocation] = useLocation();
  const { data: settings, isLoading: isLoadingSettings } = useGetBookSettings();
  const orderIdempotencyKey = useRef(crypto.randomUUID()).current;
  const createOrder = useCreateBookOrder({
    request: { headers: { "Idempotency-Key": orderIdempotencyKey } },
  });
  const requestUpload = useRequestBookUpload();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [method, setMethod] = useState<"card" | "vodafone" | "instapay">("card");
  const [bookLanguage, setBookLanguage] = useState<"ar" | "en">("ar");
  
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [receiptPath, setReceiptPath] = useState<string | null>(null);
  const [submitError, setSubmitError] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (settings?.cardReady || method !== "card") return;
    if (settings?.vodafoneCash) {
      setMethod("vodafone");
    } else if (settings?.instaPay) {
      setMethod("instapay");
    }
  }, [method, settings?.cardReady, settings?.instaPay, settings?.vodafoneCash]);

  if (isLoadingSettings) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!settings?.salesEnabled || !settings.price) {
    return (
      <div className="flex min-h-[80vh] items-center justify-center p-4">
        <Card className="max-w-md w-full text-center p-8">
          <AlertCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
          <CardTitle className="mb-2 text-2xl">{t('buy.not_ready')}</CardTitle>
          {settings?.price ? (
            <CardDescription className="text-base space-y-1">
              {settings.offerAvailable && settings.offerPrice ? (
                <>
                  <span className="block line-through">{settings.price} {settings.currency.toUpperCase()}</span>
                  <span className="block font-bold text-primary">{t('buy.first_edition_offer')} {settings.offerPrice} {settings.currency.toUpperCase()}</span>
                  <span className="block">{t('buy.first_100_note')}</span>
                </>
              ) : (
                <span>{t('buy.regular_price')} {settings.price} {settings.currency.toUpperCase()}</span>
              )}
            </CardDescription>
          ) : <CardDescription className="text-base">{t('buy.price_coming')}</CardDescription>}
        </Card>
      </div>
    );
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;
    
    if (selected.size > 5 * 1024 * 1024) {
      setUploadError("File must be under 5MB");
      return;
    }
    
    setFile(selected);
    setUploadError("");
    setReceiptPath(null); // Reset path if new file chosen
  };

  const doUpload = async () => {
    if (!file) return null;
    setIsUploading(true);
    setUploadError("");
    
    try {
      const { uploadURL, objectPath } = await requestUpload.mutateAsync({
        data: {
          name: file.name,
          size: file.size,
          contentType: file.type as any,
          purpose: "receipt"
        }
      });
      
      const res = await fetch(uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      
      if (!res.ok) throw new Error("Upload to storage failed");
      
      setReceiptPath(objectPath);
      setIsUploading(false);
      return objectPath;
    } catch (err: any) {
      setIsUploading(false);
      setUploadError(err.message || "Upload failed");
      return null;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError("");
    if (!name || !email) return;
    const expectedAmount =
      settings.offerAvailable && settings.offerPrice !== null
        ? settings.offerPrice
        : settings.price;
    if (expectedAmount === null) {
      setSubmitError(t('buy.price_coming'));
      return;
    }
    
    let finalPath = receiptPath;
    
    if (method !== "card" && file && !receiptPath) {
      finalPath = await doUpload();
      if (!finalPath) return; // Error handled in doUpload
    }
    
    try {
      const order = await createOrder.mutateAsync({
        data: {
          name,
          email,
          method,
          language: bookLanguage,
          expectedAmount,
          expectedCurrency: settings.currency as "egp" | "usd",
          ...(finalPath ? { receiptObjectPath: finalPath } : {})
        }
      });
      
      if (method === "card" && order.checkoutUrl) {
        window.location.href = order.checkoutUrl;
      } else {
        setLocation(`/user-portal?order=${order.id}`);
      }
    } catch (error: unknown) {
      const apiError = error as { data?: { error?: string } };
      setSubmitError(apiError.data?.error || t('checkout.error'));
    }
  };

  const needsReceipt = method === "vodafone" || method === "instapay";

  return (
    <div className="container mx-auto px-4 py-12 max-w-2xl">
      <Card className="border-border shadow-xl">
        <CardHeader className="text-center border-b border-border/50 pb-6 bg-muted/30">
          <CardTitle className="text-3xl font-bold">{t('checkout.title')}</CardTitle>
          {settings.offerAvailable && settings.offerPrice ? (
            <div className="mt-4 space-y-1">
              <div className="text-muted-foreground line-through">{settings.price} {settings.currency.toUpperCase()}</div>
              <div className="inline-flex items-center justify-center px-4 py-2 bg-primary/10 text-primary rounded-full font-bold text-xl border border-primary/20">
                {t('buy.first_edition_offer')} {settings.offerPrice} {settings.currency.toUpperCase()}
              </div>
              <p className="text-sm text-muted-foreground">{t('checkout.offer_terms')}</p>
            </div>
          ) : (
            <div className="mt-4 inline-flex items-center justify-center px-4 py-2 bg-primary/10 text-primary rounded-full font-bold text-xl border border-primary/20">
              {settings.price} {settings.currency.toUpperCase()}
            </div>
          )}
        </CardHeader>
        
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-8 pt-8">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">{t('checkout.name')}</Label>
                <Input 
                  id="name" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  required 
                  className="h-12 text-base"
                />
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="email">{t('checkout.email')}</Label>
                <Input 
                  id="email" 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  required 
                  className="h-12 text-base"
                />
              </div>

              <div className="space-y-2 pt-4">
                <Label>{t('checkout.lang_pref')}</Label>
                <RadioGroup 
                  value={bookLanguage} 
                  onValueChange={(v: "ar" | "en") => setBookLanguage(v)}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2 rtl:space-x-reverse border border-border rounded-md px-4 py-3 flex-1">
                    <RadioGroupItem value="ar" id="lang-ar" />
                    <Label htmlFor="lang-ar" className="cursor-pointer">عربي (Arabic)</Label>
                  </div>
                  <div className="flex items-center space-x-2 rtl:space-x-reverse border border-border rounded-md px-4 py-3 flex-1">
                    <RadioGroupItem value="en" id="lang-en" />
                    <Label htmlFor="lang-en" className="cursor-pointer">English</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-border/50">
              <Label className="text-lg">{t('checkout.method')}</Label>
              <RadioGroup 
                value={method} 
                onValueChange={(v: "card" | "vodafone" | "instapay") => {
                  setMethod(v);
                  setFile(null);
                  setReceiptPath(null);
                }}
                className="grid gap-3"
              >
                {settings.cardReady && (
                  <div className={`flex items-center space-x-3 rtl:space-x-reverse border rounded-lg p-4 cursor-pointer transition-colors ${method === 'card' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                    <RadioGroupItem value="card" id="card" />
                    <Label htmlFor="card" className="flex-1 flex items-center gap-3 cursor-pointer text-base">
                      <div className="w-10 h-10 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400">
                        <CreditCard className="w-5 h-5" />
                      </div>
                      {t('checkout.card')}
                    </Label>
                  </div>
                )}
                
                {settings.vodafoneCash && (
                  <div className={`flex items-center space-x-3 rtl:space-x-reverse border rounded-lg p-4 cursor-pointer transition-colors ${method === 'vodafone' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                    <RadioGroupItem value="vodafone" id="vodafone" />
                    <Label htmlFor="vodafone" className="flex-1 flex items-center gap-3 cursor-pointer text-base">
                      <div className="w-10 h-10 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center text-red-600 dark:text-red-400">
                        <Smartphone className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-semibold">{t('checkout.vodafone')}</div>
                        <div className="text-sm text-muted-foreground mt-1 select-all">{settings.vodafoneCash}</div>
                      </div>
                    </Label>
                  </div>
                )}
                
                {settings.instaPay && (
                  <div className={`flex items-center space-x-3 rtl:space-x-reverse border rounded-lg p-4 cursor-pointer transition-colors ${method === 'instapay' ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50'}`}>
                    <RadioGroupItem value="instapay" id="instapay" />
                    <Label htmlFor="instapay" className="flex-1 flex items-center gap-3 cursor-pointer text-base">
                      <div className="w-10 h-10 rounded-full bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center text-purple-600 dark:text-purple-400">
                        <Banknote className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="font-semibold">{t('checkout.instapay')}</div>
                        <div className="text-sm text-muted-foreground mt-1 select-all">{settings.instaPay}</div>
                      </div>
                    </Label>
                  </div>
                )}
              </RadioGroup>
            </div>
            
            {needsReceipt && (
              <div className="p-6 bg-muted/30 rounded-lg border border-border border-dashed space-y-4">
                <div className="flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  <p className="text-sm text-muted-foreground">
                    {t('checkout.receipt_help')}
                  </p>
                </div>
                
                <div className="pt-2">
                  <input 
                    type="file" 
                    accept="image/jpeg,image/png,application/pdf" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileChange}
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full h-12 border-dashed border-2 hover:border-primary hover:bg-primary/5"
                  >
                    <UploadCloud className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
                    {file ? file.name : t('checkout.choose_file')}
                  </Button>
                  
                  {uploadError && <p className="text-sm text-destructive mt-2">{uploadError}</p>}
                  {receiptPath && <p className="text-sm text-green-600 mt-2">{t('checkout.success')}</p>}
                </div>
              </div>
            )}
            {submitError && (
              <p className="text-sm text-destructive flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                {submitError}
              </p>
            )}
          </CardContent>
          
          <CardFooter className="bg-muted/30 border-t border-border/50 p-6">
            <Button 
              type="submit" 
              className="w-full h-14 text-lg font-bold"
              disabled={createOrder.isPending || isUploading || (needsReceipt && !file && !receiptPath)}
            >
              {createOrder.isPending || isUploading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                t('checkout.submit')
              )}
            </Button>
          </CardFooter>
        </form>
      </Card>
    </div>
  );
}
