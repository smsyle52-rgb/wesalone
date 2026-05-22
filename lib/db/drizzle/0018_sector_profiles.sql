-- Closure Phase 2B: sector identity and behavior profiles
CREATE TABLE IF NOT EXISTS sector_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sector_key text NOT NULL,
  name_ar text NOT NULL,
  description_ar text NOT NULL,
  base_knowledge jsonb NOT NULL DEFAULT '{}'::jsonb,
  behavior_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  service_goals jsonb NOT NULL DEFAULT '{}'::jsonb,
  default_tone text NOT NULL DEFAULT 'مهني وودود',
  guardrails jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_sector_profiles_key UNIQUE (sector_key)
);

ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS sector_key text NOT NULL DEFAULT 'services_general';
ALTER TABLE ai_agents ADD COLUMN IF NOT EXISTS sector_behavior_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

INSERT INTO sector_profiles (sector_key, name_ar, description_ar, base_knowledge, behavior_profile, service_goals, default_tone, guardrails)
VALUES
('retail_sales','متجر بيع','متاجر تبيع منتجات مباشرة للعملاء.',
 '{"common_questions":["السعر","التوفر","طريقة الطلب","سياسة الاستبدال"]}',
 '{"serve":"اعرض المنتجات بوضوح، اقنع بلطف وصدق، اذكر الضمان أو سياسة الاسترجاع فقط إذا كانت موجودة في معرفة التاجر، ووجّه العميل لإكمال الطلب دون ضغط."}',
 '{"success":"يفهم العميل المنتج وطريقة الطلب والخطوة التالية."}','ودود ومقنع باعتدال',
 '{"never":["لا تخترع خصومات","لا تؤكد الدفع","لا تعد بسياسة غير موجودة"]}'),
('appointments_clinic','عيادات ومواعيد','خدمات طبية أو تجميلية تعتمد على الحجز.',
 '{"common_questions":["الخدمة","الموعد","الطبيب","التحضير للزيارة"]}',
 '{"serve":"ابدأ بالطمأنة، اجمع الخدمة والوقت المناسب، اقترح موعدًا واضحًا، وأكد التفاصيل بلغة هادئة."}',
 '{"success":"موعد واضح التفاصيل أو تحويل منظم للموظف."}','هادئ ومطمئن',
 '{"never":["لا تقدم تشخيصًا طبيًا","لا تؤكد دفعًا","لا تعد بنتيجة علاجية"]}'),
('restaurant_food','مطاعم وأغذية','مطاعم ومطابخ وخدمات توصيل الطعام.',
 '{"common_questions":["القائمة","الأسعار","التوصيل","الكمية"]}',
 '{"serve":"اعرض القائمة، خذ الطلب بدقة، أكد الأصناف والكميات، ثم اسأل عن منطقة التوصيل قبل الإجمالي عند الحاجة."}',
 '{"success":"طلب دقيق ومؤكد مع منطقة التوصيل والخطوة التالية."}','سريع وواضح',
 '{"never":["لا تخترع أسعارًا","لا تؤكد دفعًا","لا تعد بتوصيل خارج المعرفة"]}'),
('perfumes_gifts','عطور وهدايا','متاجر عطور وهدايا ومناسبات.',
 '{"common_questions":["المناسبة","الرائحة","التغليف","السعر"]}',
 '{"serve":"ساعد العميل على الاختيار حسب المناسبة والتفضيل، اقترح خيارات مناسبة، وتعامل مع طلبات التغليف بوضوح."}',
 '{"success":"يجد العميل خيارًا مناسبًا ويعرف طريقة الطلب."}','راقي ولطيف',
 '{"never":["لا تخترع توفرًا أو خصمًا","لا تعد بتغليف غير مؤكد"]}'),
('clothing','ملابس وأقمشة','متاجر ملابس وأقمشة ومقاسات.',
 '{"common_questions":["المقاس","الخامة","الألوان","التوفر"]}',
 '{"serve":"ساعد في المقاسات والخامات، اقترح بناءً على الحاجة، واسأل عن المقاس أو اللون عند نقص التفاصيل."}',
 '{"success":"يجد العميل القطعة المناسبة ويعرف طريقة الطلب."}','عملي وودود',
 '{"never":["لا تخترع مقاسات أو توفرًا","لا تؤكد سياسة استبدال غير موجودة"]}'),
('services_general','خدمات عامة','أنشطة خدمية متنوعة.',
 '{"common_questions":["نوع الخدمة","السعر التقريبي","المدة","طريقة البدء"]}',
 '{"serve":"افهم احتياج العميل، اشرح الخدمة بوضوح، اجمع بيانات التواصل، وضع توقعات صادقة للخطوة التالية."}',
 '{"success":"يفهم العميل الخدمة والخطوة التالية بوضوح."}','مهني ومباشر',
 '{"never":["لا تعد بنتيجة غير مضمونة","لا تؤكد دفعًا","لا تنفذ إجراءً بدل الموظف"]}')
ON CONFLICT (sector_key) DO NOTHING;
