export class Product {
  constructor(
    public readonly id: string,
    public age: number,
    public type: string,
    public imageUrl: string,
    public name: string,
    public snippet: string,
    public price: number,
    public discount: number,
    public screen: string,
    public capacity: string,
    public ram: string,
  ) {}
}

export interface IPaginationProduct {
  items: Product[];
  totalItems: number;
  itemCount: number;
  itemsPerPage: number;
  totalPages: number;
  currentPage: number;
}
