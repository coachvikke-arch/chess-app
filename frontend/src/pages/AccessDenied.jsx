import { ErrorPageLayout } from '../components/ErrorPageLayout';

export default function AccessDenied() {
  return (
    <ErrorPageLayout
      code="403"
      title="Access Denied"
      message="You don't have permission to view this page. If you think this is a mistake, please contact your coach or administrator."
      icon="♚"
      iconAriaLabel="A king piece behind a lock, representing restricted access"
      accentColor="amber"
      showAttemptedUrl={true}
      pageTitle="Access Denied"
    />
  );
}