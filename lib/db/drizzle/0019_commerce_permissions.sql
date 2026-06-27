INSERT INTO permissions (resource, action, slug, description) VALUES
  ('inventory', 'read', 'inventory:read', 'عرض المخزون ومواقعه وحركاته'),
  ('inventory', 'manage', 'inventory:manage', 'إدارة مواقع المخزون والحجوزات'),
  ('inventory', 'adjust', 'inventory:adjust', 'تعديل أرصدة المخزون مع سبب'),
  ('payments', 'refund', 'payments:refund', 'إنشاء واعتماد استرجاعات المدفوعات')
ON CONFLICT (slug) DO UPDATE SET
  resource = EXCLUDED.resource,
  action = EXCLUDED.action,
  description = EXCLUDED.description;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('inventory:read', 'inventory:manage', 'inventory:adjust', 'payments:refund')
WHERE r.is_system = true AND r.slug IN ('owner', 'manager')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug = 'inventory:read'
WHERE r.is_system = true AND r.slug IN ('agent', 'viewer')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug = 'payments:refund'
WHERE r.is_system = true AND r.slug = 'accountant'
ON CONFLICT DO NOTHING;
