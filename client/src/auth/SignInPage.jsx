import { SignIn } from "@hexclave/react";

export default function SignInPage() {
  return (
    <div className="auth-page">
      <div className="auth-page-panel">
        <SignIn fullPage automaticRedirect />
      </div>
    </div>
  );
}
