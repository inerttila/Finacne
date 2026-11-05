import { SignUp } from "@hexclave/react";

export default function SignUpPage() {
  return (
    <div className="auth-page">
      <div className="auth-page-panel">
        <SignUp fullPage automaticRedirect />
      </div>
    </div>
  );
}
