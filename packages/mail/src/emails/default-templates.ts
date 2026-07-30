import { buildSystemEmail } from "./base-template"
import {
  buildAccountCredentialsMjml,
  DEFAULT_ACCOUNT_CREDENTIALS_SUBJECT,
} from "./sign-up-credentials"

function buildDefaultMjml(subject: string, bodyMjml: string): string {
  return buildSystemEmail(
    {
      brandName: "{{brandName}}",
      brandLogoUrl: "{{brandLogoUrl}}",
      brandUrl: "{{brandUrl}}",
      subject,
    },
    bodyMjml,
  )
}

export const DEFAULT_SIGNUP_SUBJECT = "Verify your email address"

export const SIGNUP_BODY_MJML = `<mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0 0 8px 0">Hi {{userName}},</mj-text>
        <mj-text padding="0">
          Thanks for signing up! Please verify your email address by clicking the button below.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-button href="{{verificationUrl}}" align="left">Verify Email Address</mj-button>
        <mj-text padding="8px 0 0 0" font-size="13px" color="#888888">
          Or use this link: <a href="{{verificationUrl}}" style="color:#3b82f6">{{verificationUrl}}</a>
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0" font-size="14px" color="#888888">
          This link will expire in 24 hours. If you didn't create an account, you can ignore this email.
        </mj-text>
      </mj-column>
    </mj-section>`

export const DEFAULT_SIGNUP_TEMPLATE = buildDefaultMjml(
  DEFAULT_SIGNUP_SUBJECT,
  SIGNUP_BODY_MJML,
)

// Arabic runtime default for the root tenant (wesal.one), selected by locale
// in packages/auth/src/server.ts. Kept separate from DEFAULT_SIGNUP_SUBJECT /
// DEFAULT_SIGNUP_TEMPLATE above, which also feed the enterprise white-label
// admin's "reset to default" email-template editor and must stay untouched.
export const SIGNUP_SUBJECT_AR = "تحقّق من بريدك الإلكتروني"

export const SIGNUP_BODY_MJML_AR = `<mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0 0 8px 0" align="right">مرحبًا {{userName}}،</mj-text>
        <mj-text padding="0" align="right">
          شكرًا لتسجيلك! يرجى تأكيد بريدك الإلكتروني بالضغط على الزر أدناه.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-button href="{{verificationUrl}}" align="right">تأكيد البريد الإلكتروني</mj-button>
        <mj-text padding="8px 0 0 0" font-size="13px" color="#888888" align="right">
          أو استخدم هذا الرابط: <a href="{{verificationUrl}}" style="color:#3b82f6">{{verificationUrl}}</a>
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0" font-size="14px" color="#888888" align="right">
          سينتهي هذا الرابط خلال 24 ساعة. إذا لم تُنشئ حسابًا، يمكنك تجاهل هذه الرسالة.
        </mj-text>
      </mj-column>
    </mj-section>`

export const DEFAULT_FORGOT_PASSWORD_SUBJECT = "Reset your password"

export const FORGOT_PASSWORD_BODY_MJML = `<mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0 0 8px 0">Hi {{userName}},</mj-text>
        <mj-text padding="0">
          We received a request to reset the password for your account.
          Click the button below to set a new password.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-button href="{{resetPasswordUrl}}" align="left">Reset Password</mj-button>
        <mj-text padding="8px 0 0 0" font-size="13px" color="#888888">
          Or use this link: <a href="{{resetPasswordUrl}}" style="color:#3b82f6">{{resetPasswordUrl}}</a>
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0" font-size="14px" color="#888888">
          This link will expire in 1 hour. If you didn't request a password reset,
          you can safely ignore this email — your password won't be changed.
        </mj-text>
      </mj-column>
    </mj-section>`

export const DEFAULT_FORGOT_PASSWORD_TEMPLATE = buildDefaultMjml(
  DEFAULT_FORGOT_PASSWORD_SUBJECT,
  FORGOT_PASSWORD_BODY_MJML,
)

// Arabic runtime default — see the note on SIGNUP_SUBJECT_AR above.
export const FORGOT_PASSWORD_SUBJECT_AR = "إعادة تعيين كلمة المرور"

export const FORGOT_PASSWORD_BODY_MJML_AR = `<mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0 0 8px 0" align="right">مرحبًا {{userName}}،</mj-text>
        <mj-text padding="0" align="right">
          وصلنا طلب لإعادة تعيين كلمة مرور حسابك. اضغط على الزر أدناه لتعيين كلمة مرور جديدة.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-button href="{{resetPasswordUrl}}" align="right">إعادة تعيين كلمة المرور</mj-button>
        <mj-text padding="8px 0 0 0" font-size="13px" color="#888888" align="right">
          أو استخدم هذا الرابط: <a href="{{resetPasswordUrl}}" style="color:#3b82f6">{{resetPasswordUrl}}</a>
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0" font-size="14px" color="#888888" align="right">
          سينتهي هذا الرابط خلال ساعة واحدة. إذا لم تطلب إعادة التعيين، يمكنك تجاهل هذه الرسالة ولن تتغيّر كلمة مرورك.
        </mj-text>
      </mj-column>
    </mj-section>`

export const DEFAULT_MAGIC_LINK_SUBJECT = "Sign in to {{brandName}}"

export const MAGIC_LINK_BODY_MJML = `<mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0 0 8px 0">Hi {{userName}},</mj-text>
        <mj-text padding="0">
          Click the button below to securely sign in to your {{brandName}} account.
          This link will expire in 15 minutes and can only be used once.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-button href="{{magicUrl}}" align="left">Sign in to {{brandName}}</mj-button>
        <mj-text padding="8px 0 0 0" font-size="13px" color="#888888">
          Or use this link: <a href="{{magicUrl}}" style="color:#3b82f6">{{magicUrl}}</a>
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0" font-size="14px" color="#888888">
          If you didn't request this, you can safely ignore this email.
        </mj-text>
      </mj-column>
    </mj-section>`

export const DEFAULT_MAGIC_LINK_TEMPLATE = buildDefaultMjml(
  DEFAULT_MAGIC_LINK_SUBJECT,
  MAGIC_LINK_BODY_MJML,
)

// Arabic runtime default — see the note on SIGNUP_SUBJECT_AR above.
// {{brandName}} is substituted by sendEmailWithTemplate, same as the English one.
export const MAGIC_LINK_SUBJECT_AR = "تسجيل الدخول إلى {{brandName}}"

export const MAGIC_LINK_BODY_MJML_AR = `<mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0 0 8px 0" align="right">مرحبًا {{userName}}،</mj-text>
        <mj-text padding="0" align="right">
          اضغط على الزر أدناه لتسجيل الدخول بأمان إلى حسابك في {{brandName}}. ينتهي هذا الرابط خلال 15 دقيقة ويُستخدم مرة واحدة فقط.
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-button href="{{magicUrl}}" align="right">تسجيل الدخول إلى {{brandName}}</mj-button>
        <mj-text padding="8px 0 0 0" font-size="13px" color="#888888" align="right">
          أو استخدم هذا الرابط: <a href="{{magicUrl}}" style="color:#3b82f6">{{magicUrl}}</a>
        </mj-text>
      </mj-column>
    </mj-section>
    <mj-section padding="0 0 16px 0">
      <mj-column>
        <mj-text padding="0" font-size="14px" color="#888888" align="right">
          إذا لم تطلب هذا، يمكنك تجاهل هذه الرسالة بأمان.
        </mj-text>
      </mj-column>
    </mj-section>`

export const DEFAULT_ACCOUNT_CREDENTIALS_TEMPLATE = buildAccountCredentialsMjml(
  {
    brandName: "{{brandName}}",
    brandLogoUrl: "{{brandLogoUrl}}",
    brandUrl: "{{brandUrl}}",
    subject: DEFAULT_ACCOUNT_CREDENTIALS_SUBJECT,
    userName: "{{userName}}",
    loginEmail: "{{loginEmail}}",
    initialPassword: "{{initialPassword}}",
    signInUrl: "{{signInUrl}}",
  },
)
