/** Shape attached to `req.user` by CustomerJwtStrategy after a valid customer access token. */
export interface CustomerRequestUser {
  customerId: string;
  tenantId: string;
}
