import { paginate } from './paginate.mjs';

export function listProducts(products, page) {
  return paginate(products, { page });
}
