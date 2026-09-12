import { useState, useRef, useEffect } from "react";
import { useLanguage } from "@/lib/i18n";
import { 
  useGetBookMe, 
  useGetBookSettings, 
  useSaveBookSettings, 
  useListAdminBookOrders,
  getListAdminBookOrdersQueryKey,
  useReviewBookOrder,
  useRequestBookUpload,
  BookOrder
} from "@workspace/api-client-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Settings, Users, UploadCloud, CheckCircle2, XCircle, FileImage, ShieldAlert } from "lucide-react";
import { format } from "date-fns";

export default function Admin() {
  const { t } = useLanguage();
  const { toast } = useToast();
  
  const { data: me, isLoading: meLoading } = useGetBookMe();
  
  if (meLoading) return <div className="p-12 text-center"><Loader2 className="w-8 h-8 animate-spin mx-auto" /></div>;
  if (!me?.isAdmin) return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <div className="text-center space-y-4">
        <ShieldAlert className="w-16 h-16 text-destructive mx-auto" />
        <h2 className="text-2xl font-bold text-destructive">{t('admin.no_admin')}</h2>
      </div>
    </div>
  );

  return (
    <div className="container mx-auto px-4 py-8 max-w-6xl">
      <div className="flex items-center gap-3 mb-8">
        <Settings className="w-8 h-8 text-primary" />
        <h1 className="text-3xl font-bold">{t('admin.title')}</h1>
      </div>
      
      <Tabs defaultValue="orders" className="w-full">
        <TabsList className="mb-6 grid w-full max-w-md grid-cols-2">
          <TabsTrigger value="orders" className="gap-2"><Users className="w-4 h-4" /> {t('admin.orders')}</TabsTrigger>
          <TabsTrigger value="settings" className="gap-2"><Settings className="w-4 h-4" /> {t('admin.settings')}</TabsTrigger>
        </TabsList>
        
        <TabsContent value="orders">
          <AdminOrders />
        </TabsContent>
        
        <TabsContent value="settings">
          <AdminSettings />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function AdminSettings() {
  const { t } = useLanguage();
  const { toast } = useToast();
  
  const { data: settings, isLoading } = useGetBookSettings();
  const saveSettings = useSaveBookSettings();
  const requestUpload = useRequestBookUpload();
  
  const [price, setPrice] = useState("");
  const [offerPrice, setOfferPrice] = useState("");
  const [offerLimit, setOfferLimit] = useState("100");
  const [currency, setCurrency] = useState<"egp"|"usd">("egp");
  const [vodafone, setVodafone] = useState("");
  const [instapay, setInstapay] = useState("");
  const [salesEnabled, setSalesEnabled] = useState(false);
  
  const [file, setFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const initRef = useRef(false);

  useEffect(() => {
    if (settings && !initRef.current) {
      setPrice(settings.price?.toString() || "");
      setOfferPrice(settings.offerPrice?.toString() || "");
      setOfferLimit(settings.offerLimit.toString());
      setCurrency(settings.currency as "egp"|"usd" || "egp");
      setVodafone(settings.vodafoneCash || "");
      setInstapay(settings.instaPay || "");
      setSalesEnabled(settings.salesEnabled);
      initRef.current = true;
    }
  }, [settings]);

  const handleSave = async () => {
    try {
      let bookObjectPath = undefined;
      
      if (file) {
        setIsUploading(true);
        const { uploadURL, objectPath } = await requestUpload.mutateAsync({
          data: {
            name: file.name,
            size: file.size,
            contentType: file.type as any,
            purpose: "book"
          }
        });
        
        const res = await fetch(uploadURL, {
          method: "PUT",
          headers: { "Content-Type": file.type },
          body: file,
        });
        
        if (!res.ok) throw new Error("Upload failed");
        bookObjectPath = objectPath;
        setFile(null);
      }
      
      await saveSettings.mutateAsync({
        data: {
          price: Number(price) || 0,
          offerPrice: Number(offerPrice) || 0,
          offerLimit: Number(offerLimit) || 0,
          currency,
          vodafoneCash: vodafone,
          instaPay: instapay,
          salesEnabled,
          ...(bookObjectPath ? { bookObjectPath } : {})
        }
      });
      
      setIsUploading(false);
      toast({ title: "تم الحفظ بنجاح" });
    } catch (err: any) {
      setIsUploading(false);
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    }
  };

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.settings')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <Label>{t('admin.regular_price')}</Label>
            <Input type="number" value={price} onChange={e => setPrice(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('admin.offer_price')}</Label>
            <Input type="number" value={offerPrice} onChange={e => setOfferPrice(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('admin.offer_limit')}</Label>
            <Input type="number" min="1" value={offerLimit} onChange={e => setOfferLimit(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('admin.currency')}</Label>
            <select 
              value={currency} 
              onChange={e => setCurrency(e.target.value as any)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              <option value="egp">EGP</option>
              <option value="usd">USD</option>
            </select>
          </div>
          <div className="space-y-2">
            <Label>{t('admin.v_cash')}</Label>
            <Input value={vodafone} onChange={e => setVodafone(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label>{t('admin.i_pay')}</Label>
            <Input value={instapay} onChange={e => setInstapay(e.target.value)} />
          </div>
        </div>
        <p className="rounded-md border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
          {t('admin.offer_policy')}
        </p>

        <div className="flex items-center space-x-2 rtl:space-x-reverse py-4 border-y">
          <Switch id="sales-mode" checked={salesEnabled} onCheckedChange={setSalesEnabled} />
          <Label htmlFor="sales-mode" className="font-bold">{t('admin.sales_enabled')}</Label>
        </div>

        <div className="space-y-2">
          <Label>{t('admin.upload_book')} (PDF, max 50MB)</Label>
          <div className="flex gap-4 items-center">
            <input 
              type="file" 
              accept="application/pdf" 
              className="hidden" 
              ref={fileInputRef}
              onChange={e => setFile(e.target.files?.[0] || null)}
            />
            <Button variant="outline" onClick={() => fileInputRef.current?.click()}>
              <UploadCloud className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
              {file ? file.name : "اختر ملف الكتاب"}
            </Button>
            {settings?.bookReady && !file && (
              <span className="text-green-600 text-sm flex items-center gap-1">
                <CheckCircle2 className="w-4 h-4" /> {t('admin.book_ready')}
              </span>
            )}
          </div>
        </div>

        <Button onClick={handleSave} disabled={saveSettings.isPending || isUploading} className="w-full sm:w-auto">
          {saveSettings.isPending || isUploading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
          {t('admin.save')}
        </Button>
      </CardContent>
    </Card>
  );
}

function AdminOrders() {
  const { t } = useLanguage();
  const { data: orders, isLoading, refetch } = useListAdminBookOrders(
    { query: { refetchInterval: 10000, queryKey: getListAdminBookOrdersQueryKey() } }
  );
  
  const [reviewOrder, setReviewOrder] = useState<BookOrder | null>(null);

  if (isLoading) return <Loader2 className="w-6 h-6 animate-spin" />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('admin.orders')}</CardTitle>
        <CardDescription>{t('admin.pending_orders')}: {orders?.length ?? 0}</CardDescription>
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Method</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Date</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders?.map(order => (
              <TableRow key={order.id}>
                <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}</TableCell>
                <TableCell>
                  <div className="font-medium">{order.name}</div>
                  <div className="text-xs text-muted-foreground">{order.email}</div>
                </TableCell>
                <TableCell>
                  <span className="capitalize">{order.method}</span>
                  <div className="text-xs font-medium">{order.amount} {order.currency}</div>
                  <div className="text-xs text-muted-foreground">{order.priceTier === "offer" ? t('admin.offer_order') : t('admin.regular_order')}</div>
                </TableCell>
                <TableCell>
                  <span className={`px-2 py-1 rounded text-xs font-medium ${
                    order.status === 'paid' ? 'bg-green-100 text-green-800' :
                    order.status === 'rejected' ? 'bg-red-100 text-red-800' :
                    'bg-yellow-100 text-yellow-800'
                  }`}>
                    {order.status}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {format(new Date(order.createdAt), "dd MMM HH:mm")}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="outline" onClick={() => setReviewOrder(order)}>
                    Review
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
      
      {reviewOrder && (
        <ReviewDialog 
          order={reviewOrder} 
          onClose={() => setReviewOrder(null)} 
          onReviewed={() => {
            setReviewOrder(null);
            refetch();
          }} 
        />
      )}
    </Card>
  );
}

function ReviewDialog({ order, onClose, onReviewed }: { order: BookOrder, onClose: () => void, onReviewed: () => void }) {
  const { t } = useLanguage();
  const reviewMutation = useReviewBookOrder();
  const [note, setNote] = useState(order.reviewNote || "");

  const handleReview = async (status: 'paid'|'rejected') => {
    try {
      await reviewMutation.mutateAsync({
        id: order.id,
        data: { status, reviewNote: note }
      });
      onReviewed();
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Review Order {order.id.slice(0, 8)}</DialogTitle>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4 text-sm bg-muted/30 p-4 rounded border">
            <div>
              <span className="text-muted-foreground block">Name</span>
              <span className="font-medium">{order.name}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Email</span>
              <span className="font-medium">{order.email}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Method</span>
              <span className="font-medium uppercase">{order.method}</span>
            </div>
            <div>
              <span className="text-muted-foreground block">Amount</span>
              <span className="font-medium text-primary">{order.amount} {order.currency}</span>
            </div>
          </div>

          {order.hasReceipt && (
            <div className="pt-2">
              <Button asChild variant="outline" className="w-full">
                <a href={`/api/book/admin/orders/${order.id}/receipt`} target="_blank" rel="noreferrer">
                  <FileImage className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
                  {t('admin.view_receipt')}
                </a>
              </Button>
            </div>
          )}

          <div className="space-y-2 pt-4">
            <Label>{t('admin.review_note')}</Label>
            <Textarea 
              value={note} 
              onChange={e => setNote(e.target.value)} 
              placeholder="Optional note sent to buyer..."
            />
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button 
            variant="destructive" 
            onClick={() => handleReview('rejected')}
            disabled={reviewMutation.isPending}
          >
            <XCircle className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
            {t('admin.reject')}
          </Button>
          <Button 
            className="bg-green-600 hover:bg-green-700" 
            onClick={() => handleReview('paid')}
            disabled={reviewMutation.isPending}
          >
            <CheckCircle2 className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
            {t('admin.approve')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
