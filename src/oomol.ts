/**
 * Complete successful OOMOL API responses.
 */

export type CredentialAuthType = "oauth2" | "api_key" | "custom_credential" | "no_auth" | "federated";

export interface ProviderIconSprite {
  version: string;
  pixelRatio: number;
  iconSize: number;
  bleed: number;
  width: number;
  height: number;
  lightUrl: string;
  darkUrl: string;
}

export interface ProviderListItem {
  service: string;
  displayName: string;
  searchAliases: string[];
  iconUrl: string | null;
  homepageUrl: string | null;
  categories: { id: string; displayName: string }[];
  authTypes: CredentialAuthType[];
  iconSpritePosition: { x: number; y: number } | null;
}

/** Complete GET /v1/providers success response, including sprite metadata. */
export interface ProvidersResponse {
  success: true;
  message: string;
  data: ProviderListItem[];
  meta: { totalCount: number; iconSprite: ProviderIconSprite | null };
}

export type ActionAsyncLifecycle =
  | {
      role: "submit";
      resultAction: string;
      handle: { outputField: string; inputField: string };
    }
  | {
      role: "result";
      wait: {
        intervalSeconds: number;
        state: { field: string; running: string[]; success: string[]; failure: string[] };
        resultField?: string;
      };
    };

export interface ActionCatalogItem {
  id: string;
  service: string;
  name: string;
  description: string;
  operationType: "read" | "write" | "destructive";
  requiredScopes: string[];
  providerPermissions: string[];
  followUpActions?: {
    actionId: string;
    description?: string;
    recommended?: boolean;
    inputFromOutput?: Record<string, string>;
  }[];
  asyncLifecycle?: ActionAsyncLifecycle;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
}

/** Complete GET /v1/actions?service=… success response, excluding the service index. */
export interface ActionsResponse {
  success: true;
  message: string;
  data: ActionCatalogItem[];
}

export interface AppCatalogItem extends ProviderListItem {
  actionCount: number;
  featuredActions: { id: string; name: string; displayName: string }[];
  status: "available" | "degraded" | "incident" | "unknown";
  healthScore?: number | null;
  lastCheckedAt?: string;
}

export interface AppCatalogSummary {
  providerCount: number;
  actionCount: number;
  categoryCount: number;
  oauthProviderCount: number;
  apiKeyProviderCount: number;
  healthyProviderCount: number | null;
}

/** Complete GET /public/v1/apps success response, including catalog aggregates and sprite metadata. */
export interface AppCatalogResponse {
  success: true;
  message: string;
  data: AppCatalogItem[];
  meta: {
    summary: AppCatalogSummary;
    categories: { id: string; displayName: string; providerCount: number; actionCount: number }[];
    authTypes: { id: CredentialAuthType; displayName: string; providerCount: number }[];
    iconSprite: ProviderIconSprite | null;
  };
}
