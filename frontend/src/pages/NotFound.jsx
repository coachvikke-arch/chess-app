import { ErrorPageLayout } from '../components/ErrorPageLayout';

export default function NotFound() {
  return (
    <ErrorPageLayout
      code="404"
      title="Oops! This move isn't on the board."
      message="The page you are looking for doesn't exist or has been moved."
      icon="♞"
      iconAriaLabel="A lone knight piece on an empty chessboard"
      accentColor="gold"
      showAttemptedUrl={true}
      pageTitle="Page Not Found"
    />
  );
}