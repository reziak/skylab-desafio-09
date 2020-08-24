import { inject, injectable } from 'tsyringe';

import AppError from '@shared/errors/AppError';

import IProductsRepository from '@modules/products/repositories/IProductsRepository';
import ICustomersRepository from '@modules/customers/repositories/ICustomersRepository';
import Order from '../infra/typeorm/entities/Order';
import IOrdersRepository from '../repositories/IOrdersRepository';

interface IProduct {
  id: string;
  quantity: number;
}

interface IRequest {
  customer_id: string;
  products: IProduct[];
}

@injectable()
class CreateOrderService {
  constructor(
    @inject('OrdersRepository')
    private ordersRepository: IOrdersRepository,

    @inject('ProductsRepository')
    private productsRepository: IProductsRepository,

    @inject('CustomersRepository')
    private customersRepository: ICustomersRepository,
  ) {}

  public async execute({ customer_id, products }: IRequest): Promise<Order> {
    const customerExists = await this.customersRepository.findById(customer_id);

    if (!customerExists) throw new AppError('No customer matching this id');

    const foundProducts = await this.productsRepository.findAllById(products);

    if (!foundProducts.length) throw new AppError('No products found');

    const foundProductsIDs = foundProducts.map(product => product.id);

    const notFoundProducts = products.filter(
      product => !foundProductsIDs.includes(product.id),
    );

    if (notFoundProducts.length) {
      const notFoundIds = notFoundProducts.reduce((acc, product) => {
        return `${acc}
        ${product.id}`;
      }, '');

      throw new AppError(
        `Could not find the following products:
        ${notFoundIds}`,
      );
    }

    const findUnavailableProducts = products.filter(product => {
      const prod = foundProducts.find(p => p.id === product.id);

      if (!prod) return false;

      return prod.quantity < product.quantity;
    });

    if (findUnavailableProducts.length) {
      const insufficientQuantity = findUnavailableProducts.reduce(
        (acc, product) => {
          const msg = `Product ${product.id} has less than ${product.quantity} units available`;

          return `${acc}
          ${msg}`;
        },
        '',
      );

      throw new AppError(insufficientQuantity);
    }

    // fix from here on out
    const serializedProducts = products.map(product => ({
      product_id: product.id,
      quantity: product.quantity,
      price: foundProducts.filter(p => p.id === product.id)[0].price,
    }));

    const order = await this.ordersRepository.create({
      customer: customerExists,
      products: serializedProducts,
    });

    const { order_products } = order;

    const orderedProductsQuantity = order_products.map(product => ({
      id: product.product_id,
      quantity:
        foundProducts.filter(p => p.id === product.product_id)[0].quantity -
        product.quantity,
    }));

    await this.productsRepository.updateQuantity(orderedProductsQuantity);

    return order;
  }
}

export default CreateOrderService;
