import { Test, TestingModule } from '@nestjs/testing';
import { WebhooksService } from './webhooks.service';
import { DatabaseModule } from '../../database/database.module';
import { PdfModule } from '../pdf/pdf.module';
import { TemplateModule } from '../template/template.module';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DatabaseService } from '../../database/database.service';
import configuration from '../../config/configuration';
import { existsSync } from 'fs';
import { join } from 'path';

describe('WebhooksService - RIDE PDF Generation', () => {
  let module: TestingModule;
  let service: WebhooksService;
  let db: DatabaseService;

  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          load: [configuration],
          envFilePath: '.env',
        }),
        EventEmitterModule.forRoot(),
        DatabaseModule,
        PdfModule,
        TemplateModule,
      ],
      providers: [
        WebhooksService,
        {
          provide: 'BullQueue_webhook-dispatch',
          useValue: { add: jest.fn() },
        },
      ],
    }).compile();

    // Trigger onModuleInit to initialize DB pool
    await module.init();

    service = module.get<WebhooksService>(WebhooksService);
    db = module.get<DatabaseService>(DatabaseService);
  });

  afterAll(async () => {
    if (module) {
      await module.close();
    }
  });

  it('should generate Carbone JSON data correctly', async () => {
    const claveAcceso = '2205202601110500875700110021000000000228066194818';
    try {
      const data = await service.getCarboneDataForFactura(claveAcceso);
      expect(data).toBeDefined();
      expect(data.claveAcceso).toBe(claveAcceso);
      expect(data.emisor).toBeDefined();
      expect(data.comprador).toBeDefined();
      expect(data.detalles.length).toBeGreaterThan(0);
      expect(data.pagos.length).toBeGreaterThan(0);
      console.log('JSON Data for Carbone:', JSON.stringify(data, null, 2));
    } catch (error) {
      console.error('Error fetching data:', error);
      throw error;
    }
  });

  it('should generate physical PDF on event interceptor', async () => {
    const claveAcceso = '2205202601110500875700110021000000000228066194818';

    // Retrieve actual emisor_id UUID from local db
    const compRow = await db.queryOne<any>(
      'SELECT emisor_id FROM comprobantes WHERE clave_acceso = $1',
      [claveAcceso],
    );
    expect(compRow).toBeDefined();

    const mockPayload = {
      emisorId: compRow.emisor_id,
      claveAcceso: claveAcceso,
      tipoComprobante: '01',
      secuencial: '000000022',
      fechaAutorizacion: '22/05/2026 09:30:00',
      numeroAutorizacion: claveAcceso,
    };

    try {
      await service.handleComprobanteAutorizado(mockPayload);
      expect(mockPayload.pdfUrl).toBeDefined();
      expect(mockPayload.pdfUrl).toContain(claveAcceso);
      console.log('Mutated Payload PDF URL:', mockPayload.pdfUrl);

      const fileName = `factura_${claveAcceso}.pdf`;
      const filePath = join(__dirname, '../../../../pdfs/others', fileName);
      expect(existsSync(filePath)).toBe(true);
      console.log('Physical PDF generated successfully at:', filePath);
    } catch (error) {
      console.error('Error in RIDE PDF generation:', error);
      throw error;
    }
  });
});
