import { useState } from "react";
import { MoonIcon, MoreHorizontalIcon, SearchIcon, SunIcon, UserIcon } from "lucide-react";
import { toast } from "sonner";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@workspace/ui/alert-dialog";
import { Avatar, AvatarFallback } from "@workspace/ui/avatar";
import { Badge } from "@workspace/ui/badge";
import { Button } from "@workspace/ui/button";
import { Checkbox } from "@workspace/ui/checkbox";
import { Combobox, ComboboxContent, ComboboxInput, ComboboxItem, ComboboxList } from "@workspace/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@workspace/ui/dialog";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger } from "@workspace/ui/drawer";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@workspace/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyTitle } from "@workspace/ui/empty";
import { ErrorState } from "@workspace/ui/error-state";
import { Field, FieldDescription, FieldLabel } from "@workspace/ui/field";
import { IconButton } from "@workspace/ui/icon-button";
import { Input } from "@workspace/ui/input";
import { LoadingState } from "@workspace/ui/loading-state";
import { Popover, PopoverContent, PopoverTrigger } from "@workspace/ui/popover";
import { RadioGroup, RadioGroupItem } from "@workspace/ui/radio-group";
import { ScrollArea } from "@workspace/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@workspace/ui/select";
import { Separator } from "@workspace/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@workspace/ui/sheet";
import { Skeleton } from "@workspace/ui/skeleton";
import { Switch } from "@workspace/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@workspace/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@workspace/ui/tabs";
import { Textarea } from "@workspace/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@workspace/ui/tooltip";

const choices = ["واتساب", "إنستغرام", "ماسنجر"];

export default function UiLabPage() {
  const [direction, setDirection] = useState<"rtl" | "ltr">("rtl");
  const [dark, setDark] = useState(false);

  return (
    <main dir={direction} className={dark ? "dark min-h-screen bg-background text-foreground" : "min-h-screen bg-background text-foreground"}>
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b bg-background/95 px-4 py-3">
        <div>
          <h1 className="text-xl font-bold">مختبر مكوّنات وصال ون</h1>
          <p className="text-sm text-muted-foreground">بيئة تطوير فقط</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={() => setDirection(direction === "rtl" ? "ltr" : "rtl")}>{direction.toUpperCase()}</Button>
          <IconButton aria-label="تبديل المظهر" variant="outline" onClick={() => setDark(!dark)}>
            {dark ? <SunIcon /> : <MoonIcon />}
          </IconButton>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 overflow-x-hidden p-4 md:grid-cols-2">
        <LabSection title="الأوامر والحالات">
          <div className="flex flex-wrap gap-2">
            <Button>أساسي</Button><Button variant="secondary">ثانوي</Button><Button variant="outline">حدود</Button>
            <Button variant="destructive">خطر</Button><Button disabled>معطّل</Button>
            <IconButton aria-label="بحث" variant="outline"><SearchIcon /></IconButton>
            <Badge>جديد</Badge><Badge variant="secondary">مسودة</Badge>
          </div>
          <LoadingState className="min-h-16" />
          <ErrorState className="min-h-20" description="مثال لحالة خطأ قابلة لإعادة الاستخدام." action={<Button variant="outline">إعادة المحاولة</Button>} />
        </LabSection>

        <LabSection title="النماذج والاختيار">
          <Field><FieldLabel htmlFor="lab-name">الاسم</FieldLabel><Input id="lab-name" aria-describedby="lab-name-help" placeholder="اسم العميل" /><FieldDescription id="lab-name-help">حقل نصي بدعم كامل للوحة المفاتيح.</FieldDescription></Field>
          <Field><FieldLabel htmlFor="lab-note">ملاحظة</FieldLabel><Textarea id="lab-note" placeholder="اكتب ملاحظة" /></Field>
          <div className="flex flex-wrap items-center gap-5">
            <label className="flex min-h-11 items-center gap-2"><Checkbox defaultChecked /> موافق</label>
            <label className="flex min-h-11 items-center gap-2"><Switch /> تفعيل</label>
            <RadioGroup defaultValue="one" className="flex w-auto gap-4">
              <label className="flex min-h-11 items-center gap-2"><RadioGroupItem value="one" /> الأول</label>
              <label className="flex min-h-11 items-center gap-2"><RadioGroupItem value="two" /> الثاني</label>
            </RadioGroup>
          </div>
          <Select defaultValue="wa"><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="wa">واتساب</SelectItem><SelectItem value="ig">إنستغرام</SelectItem></SelectContent></Select>
          <Combobox items={choices}><ComboboxInput placeholder="ابحث عن قناة" /><ComboboxContent><ComboboxList>{(item: string) => <ComboboxItem key={item} value={item}>{item}</ComboboxItem>}</ComboboxList></ComboboxContent></Combobox>
        </LabSection>

        <LabSection title="التنقّل والبيانات">
          <Tabs defaultValue="one"><TabsList><TabsTrigger value="one">الأول</TabsTrigger><TabsTrigger value="two">الثاني</TabsTrigger></TabsList><TabsContent value="one" className="pt-3">محتوى التبويب الأول</TabsContent><TabsContent value="two" className="pt-3">محتوى التبويب الثاني</TabsContent></Tabs>
          <Separator />
          <ScrollArea className="h-28 rounded-lg border"><div className="space-y-2 p-3">{Array.from({ length: 8 }, (_, index) => <p key={index}>عنصر قابل للتمرير {index + 1}</p>)}</div></ScrollArea>
          <Table><TableHeader><TableRow><TableHead>العميل</TableHead><TableHead>الحالة</TableHead></TableRow></TableHeader><TableBody><TableRow><TableCell>سارة</TableCell><TableCell><Badge>مفتوح</Badge></TableCell></TableRow></TableBody></Table>
        </LabSection>

        <LabSection title="الطبقات المنبثقة">
          <div className="flex flex-wrap gap-2">
            <Tooltip><TooltipTrigger render={<Button variant="outline" />}>تلميح</TooltipTrigger><TooltipContent>نص التلميح</TooltipContent></Tooltip>
            <Popover><PopoverTrigger render={<Button variant="outline" />}>Popover</PopoverTrigger><PopoverContent>محتوى منبثق</PopoverContent></Popover>
            <DropdownMenu><DropdownMenuTrigger render={<IconButton aria-label="المزيد" variant="outline"><MoreHorizontalIcon /></IconButton>} /><DropdownMenuContent><DropdownMenuItem>تعديل</DropdownMenuItem><DropdownMenuItem>أرشفة</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
            <Dialog><DialogTrigger render={<Button variant="outline" />}>Dialog</DialogTrigger><DialogContent><DialogHeader><DialogTitle>عنوان الحوار</DialogTitle><DialogDescription>يحتجز التركيز ويعيده بعد الإغلاق.</DialogDescription></DialogHeader></DialogContent></Dialog>
            <AlertDialog><AlertDialogTrigger render={<Button variant="destructive" />}>Alert</AlertDialogTrigger><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>تأكيد الإجراء</AlertDialogTitle><AlertDialogDescription>هذا مثال تأكيد واضح.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>إلغاء</AlertDialogCancel><AlertDialogAction>تأكيد</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
            <Sheet><SheetTrigger render={<Button variant="outline" />}>Sheet</SheetTrigger><SheetContent side="right"><SheetHeader><SheetTitle>لوحة جانبية</SheetTitle><SheetDescription>تعمل في RTL وLTR.</SheetDescription></SheetHeader></SheetContent></Sheet>
            <Drawer><DrawerTrigger render={<Button variant="outline" />}>Drawer</DrawerTrigger><DrawerContent><DrawerHeader><DrawerTitle>درج جوال</DrawerTitle><DrawerDescription>قابل للسحب والإغلاق بلوحة المفاتيح.</DrawerDescription></DrawerHeader></DrawerContent></Drawer>
            <Button variant="outline" onClick={() => toast.success("تم حفظ التغيير")}>Toast</Button>
          </div>
        </LabSection>

        <LabSection title="العرض والحالات الفارغة">
          <div className="flex items-center gap-3"><Avatar><AvatarFallback><UserIcon /></AvatarFallback></Avatar><Skeleton className="h-8 w-40" /></div>
          <Empty className="border"><EmptyHeader><EmptyTitle>لا توجد نتائج</EmptyTitle><EmptyDescription>جرّب تغيير معايير البحث.</EmptyDescription></EmptyHeader><EmptyContent><Button variant="outline">مسح البحث</Button></EmptyContent></Empty>
        </LabSection>
      </div>
    </main>
  );
}

function LabSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="min-w-0 space-y-4 border-b pb-6"><h2 className="text-base font-semibold">{title}</h2>{children}</section>;
}
