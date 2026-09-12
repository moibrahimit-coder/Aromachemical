import { useLanguage } from "@/lib/i18n";
import { useListBookOrders, BookOrder } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, ExternalLink, Clock, CheckCircle2, XCircle, FileText, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { ar, enUS } from "date-fns/locale";

export default function UserPortal() {
  const { t, language } = useLanguage();
  const { data: orders, isLoading } = useListBookOrders();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'pending':
        return <Badge variant="outline" className="bg-yellow-500/10 text-yellow-600 border-yellow-500/20 px-3 py-1"><Clock className="w-3 h-3 mr-1 rtl:ml-1 rtl:mr-0" /> {t('portal.pending')}</Badge>;
      case 'paid':
        return <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20 px-3 py-1"><CheckCircle2 className="w-3 h-3 mr-1 rtl:ml-1 rtl:mr-0" /> {t('portal.paid')}</Badge>;
      case 'rejected':
        return <Badge variant="outline" className="bg-red-500/10 text-red-600 border-red-500/20 px-3 py-1"><XCircle className="w-3 h-3 mr-1 rtl:ml-1 rtl:mr-0" /> {t('portal.rejected')}</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getMethodIcon = (method: string) => {
    return method === 'card' ? '💳' : method === 'vodafone' ? '📱' : '🏦';
  };

  if (isLoading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-primary border-t-transparent animate-spin"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-12 max-w-5xl">
      <h1 className="text-3xl font-bold mb-8">{t('portal.title')}</h1>
      
      {!orders || orders.length === 0 ? (
        <Card className="border-border shadow-sm p-12 text-center bg-muted/20">
          <FileText className="w-16 h-16 mx-auto text-muted-foreground mb-4 opacity-50" />
          <CardTitle className="text-xl text-muted-foreground font-medium">{t('portal.no_orders')}</CardTitle>
        </Card>
      ) : (
        <div className="space-y-6">
          {orders.map((order: BookOrder) => (
            <Card key={order.id} className="overflow-hidden border-border/60 shadow-md">
              <div className="flex flex-col md:flex-row border-b border-border/40 bg-muted/20">
                <div className="flex-1 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-sm text-muted-foreground font-mono bg-background px-2 py-1 rounded border">
                      #{order.id.slice(0, 8)}
                    </span>
                    {getStatusBadge(order.status)}
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{t('portal.date')}</p>
                      <p className="font-medium">
                        {format(new Date(order.createdAt), "dd MMM yyyy", { locale: language === 'ar' ? ar : enUS })}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{t('checkout.method')}</p>
                      <p className="font-medium flex items-center gap-2">
                        <span>{getMethodIcon(order.method)}</span>
                        {t(`checkout.${order.method}`)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">{t('portal.amount')}</p>
                      <p className="font-medium text-primary">
                        {order.amount} {order.currency.toUpperCase()}
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="p-6 bg-background flex flex-col justify-center items-center border-t md:border-t-0 md:border-l md:rtl:border-l-0 md:rtl:border-r border-border/40 min-w-[200px]">
                  {order.status === 'paid' ? (
                    <Button asChild className="w-full gap-2 shadow-sm font-bold">
                      <a href={`/api/book/orders/${order.id}/download`} download>
                        <Download className="w-4 h-4" />
                        {t('portal.download')}
                      </a>
                    </Button>
                  ) : order.status === 'pending' && order.checkoutUrl ? (
                    <Button asChild variant="outline" className="w-full gap-2">
                      <a href={order.checkoutUrl}>
                        <ExternalLink className="w-4 h-4" />
                        Complete Payment
                      </a>
                    </Button>
                  ) : (
                    <div className="text-center">
                      <p className="text-sm text-muted-foreground italic mb-2">
                        {order.status === 'pending' ? 'جاري مراجعة الإيصال' : 'تم رفض الطلب'}
                      </p>
                      <Button disabled variant="outline" className="w-full opacity-50">
                        <Download className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
                        {t('portal.download')}
                      </Button>
                    </div>
                  )}
                </div>
              </div>
              
              {order.reviewNote && (
                <div className="p-4 bg-yellow-50 dark:bg-yellow-900/10 border-t border-yellow-100 dark:border-yellow-900/20 text-yellow-800 dark:text-yellow-200 text-sm flex gap-3">
                  <AlertCircle className="w-5 h-5 shrink-0" />
                  <div>
                    <span className="font-bold block mb-1">{t('portal.note')}:</span>
                    {order.reviewNote}
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
