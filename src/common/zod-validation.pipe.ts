import { BadRequestException, PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates and transforms a request part (body, query, param) with a Zod schema.
 * Usage: `@Body(new ZodValidationPipe(createProjectSchema)) input: CreateProjectInput`
 */
export class ZodValidationPipe<T extends z.ZodType>
  implements PipeTransform<unknown, z.output<T>>
{
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        error: 'Bad Request',
        message: 'Validation failed',
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    return result.data;
  }
}
