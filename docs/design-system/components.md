# Components

Import through explicit package paths:

```tsx
import { Button } from "@workspace/ui/button"
import { Dialog, DialogContent } from "@workspace/ui/dialog"
```

The foundation includes Button, IconButton, Input, Textarea, Label, Field, Checkbox, RadioGroup, Switch, Select, Combobox, Tabs, Badge, Avatar, Tooltip, DropdownMenu, Dialog, AlertDialog, Drawer, Sheet, Popover, Sonner toast, Skeleton, Separator, ScrollArea, table primitives, Empty, LoadingState, and ErrorState.

Use `IconButton` for icon-only commands; its `aria-label` is required. Prefer semantic variants and tokens. Compose product-specific components outside this package unless they are reusable across domains.
