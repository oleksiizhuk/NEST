import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsMongoId, Max, Min } from 'class-validator';
import { MAX_ITEM_COUNT } from '@domain/shopping-cart/shopping-cart.entity';

export class AddItemHttpDto {
  @IsMongoId()
  @ApiProperty()
  itemID: string;

  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_COUNT)
  @ApiProperty({ minimum: 1, maximum: MAX_ITEM_COUNT })
  count: number;
}
