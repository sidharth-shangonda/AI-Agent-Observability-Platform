import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../../app.module';
import { AppLogger } from '../services/app-logger.service';
import { AllExceptionsFilter } from './all-exceptions.filter';
import { Controller, Get, BadRequestException, InternalServerErrorException } from '@nestjs/common';

@Controller('test-exceptions')
class TestExceptionsController {
  @Get('bad-request')
  triggerBadRequest() {
    throw new BadRequestException('Test bad request');
  }

  @Get('internal-error')
  triggerInternalError() {
    throw new InternalServerErrorException('Test internal error');
  }
}

describe('AllExceptionsFilter Integration Tests', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestExceptionsController],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter()
    );

    const logger = await app.resolve(AppLogger);
    app.useGlobalFilters(new AllExceptionsFilter(logger));

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('should format HttpException (e.g. 400 Bad Request) correctly', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/test-exceptions/bad-request',
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.statusCode).toBe(400);
    expect(body.error).toBe('Bad Request');
    expect(body.message).toBe('Test bad request');
    expect(body.timestamp).toBeDefined();
    expect(body.path).toBe('/test-exceptions/bad-request');
  });

  it('should format 500 error correctly', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/test-exceptions/internal-error',
    });

    expect(response.statusCode).toBe(500);
    const body = JSON.parse(response.payload);
    expect(body.statusCode).toBe(500);
    expect(body.error).toBe('Internal Server Error');
    expect(body.message).toBe('Test internal error');
  });
});
