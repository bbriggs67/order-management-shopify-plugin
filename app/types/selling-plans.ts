/**
 * Selling Plan Types
 * Shared types for both server and client use
 */

export interface SellingPlanDetail {
  id: string;
  name: string;
  interval: string;
  intervalCount: number;
  discount: number;
  discountType: string;
  productCount: number;
}

export interface SellingPlanProduct {
  id: string;
  title: string;
  imageUrl?: string;
  imageAlt?: string;
}

export interface SellingPlanGroupDetail {
  id: string;
  name: string;
  productCount: number;
  products: SellingPlanProduct[];
  plans: SellingPlanDetail[];
}

export interface SellingPlanConfig {
  groupId: string;
  groupName: string;
  weeklyPlanId: string | null;
  biweeklyPlanId: string | null;
  weeklyDiscount: number;
  biweeklyDiscount: number;
}
