import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface RequestContextData {
  projectId: string;
  tenantId: string;
}

export const CurrentContext = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): RequestContextData => {
    const request = ctx.switchToHttp().getRequest();
    return {
      projectId: request.project?.id || '',
      tenantId: request.project?.tenantId || '',
    };
  },
);
