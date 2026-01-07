import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { PrivateIcon } from "@/components/ui/private-icon";
import type { PrivacyState } from "@/lib/utils/privacy";

interface PrivacyMessageProps {
  state: PrivacyState;
  username: string;
}

export function PrivacyMessage({ state, username }: PrivacyMessageProps) {
  if (state === 'public' || state === 'unknown') return null;

  if (state === 'private') {
    return (
      <Alert className="mt-6">
        <PrivateIcon className="h-4 w-4" />
        <AlertTitle>This user's profile is set to private</AlertTitle>
        <AlertDescription>
          Game and achievement data is not available for private profiles. 
          Ask your friend to update their Steam privacy settings if you'd like to view their gaming activity.
        </AlertDescription>
      </Alert>
    );
  }

  // game-private
  return (
    <Alert className="mt-6">
      <PrivateIcon className="h-4 w-4" />
      <AlertTitle>Game details are set to private</AlertTitle>
      <AlertDescription>
        {username}'s profile is public, but their game details are set to private. 
        You can see their profile information and game library, but achievement data is not available. 
        Ask your friend to update their Steam privacy settings if you'd like to view their achievements.
      </AlertDescription>
    </Alert>
  );
}
