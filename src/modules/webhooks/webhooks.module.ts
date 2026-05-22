import { Module, Global } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookProcessor } from './webhook.processor';
import { DatabaseModule } from '../../database/database.module';
import { EmisoresModule } from '../emisores/emisores.module';
import { PdfModule } from '../pdf/pdf.module';
import { TemplateModule } from '../template/template.module';

@Global()
@Module({
  imports: [DatabaseModule, EmisoresModule, PdfModule, TemplateModule],
  controllers: [WebhooksController],
  providers: [WebhooksService, WebhookProcessor],
  exports: [WebhooksService],
})
export class WebhooksModule {}
