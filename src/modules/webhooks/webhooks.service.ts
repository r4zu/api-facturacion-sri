import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { DatabaseService } from '../../database/database.service';
import { PdfService } from '../pdf/pdf.service';
import { TemplateService } from '../template/template.service';
import { STORAGE_PATHS } from '../../common/utils/storage-paths';
import {
  CreateWebhookDto,
  UpdateWebhookDto,
  WebhookResponseDto,
  WebhookLogResponseDto,
  WebhookEvent,
} from './dto';
import { WebhookJobData } from './webhook.processor';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly db: DatabaseService,
    @InjectQueue('webhook-dispatch') private readonly webhookQueue: Queue,
    private readonly pdfService: PdfService,
    private readonly templateService: TemplateService,
    private readonly configService: ConfigService,
  ) {}

  // =====================
  // Event Listeners
  // =====================

  @OnEvent('comprobante.autorizado')
  async handleComprobanteAutorizado(payload: any) {
    this.logger.log(
      `Evento comprobante.autorizado recibido para ${payload.claveAcceso}`,
    );

    if (payload.tipoComprobante === '01') {
      try {
        this.logger.log(
          `Generando RIDE PDF para factura: ${payload.claveAcceso}`,
        );
        const jsonData = await this.getCarboneDataForFactura(
          payload.claveAcceso,
        );

        let templatePath: string;
        try {
          const compInfo = await this.db.queryOne<any>(
            `SELECT e.tenant_id 
             FROM comprobantes c 
             LEFT JOIN emisores e ON c.emisor_id = e.id 
             WHERE c.clave_acceso = $1`,
            [payload.claveAcceso],
          );
          const tenantId = compInfo?.tenant_id;
          if (tenantId) {
            templatePath = this.templateService.findTemplate(`${tenantId}_factura`);
          } else {
            throw new Error('No tenantId associated');
          }
        } catch (e) {
          try {
            templatePath = this.templateService.findTemplate('factura');
          } catch (e2) {
            try {
              templatePath = this.templateService.findTemplate('template');
            } catch (e3) {
              templatePath = this.templateService.findTemplate(null);
            }
          }
        }

        const pdfBuffer = await this.pdfService.generatePDF(
          jsonData,
          templatePath,
        );

        const fileName = `factura_${payload.claveAcceso}.pdf`;
        const filePath = join(STORAGE_PATHS.pdfsOthers, fileName);
        writeFileSync(filePath, pdfBuffer);

        const publicUrl = this.configService.get<string>('publicUrl')!;
        payload.pdfUrl = `${publicUrl}/pdfs/others/${fileName}`;
        this.logger.log(`RIDE PDF generado y guardado en: ${payload.pdfUrl}`);
      } catch (error: any) {
        this.logger.error(
          `Error generando RIDE PDF para ${payload.claveAcceso}: ${error.message}`,
        );
      }
    } else if (payload.tipoComprobante === '04') {
      try {
        this.logger.log(
          `Generando RIDE PDF para nota de crédito: ${payload.claveAcceso}`,
        );
        const jsonData = await this.getCarboneDataForNotaCredito(
          payload.claveAcceso,
        );

        let templatePath: string;
        try {
          const compInfo = await this.db.queryOne<any>(
            `SELECT e.tenant_id 
             FROM comprobantes c 
             LEFT JOIN emisores e ON c.emisor_id = e.id 
             WHERE c.clave_acceso = $1`,
            [payload.claveAcceso],
          );
          const tenantId = compInfo?.tenant_id;
          if (tenantId) {
            templatePath = this.templateService.findTemplate(`${tenantId}_nota-credito`);
          } else {
            throw new Error('No tenantId associated');
          }
        } catch (e) {
          try {
            templatePath = this.templateService.findTemplate('nota-credito');
          } catch (e2) {
            try {
              templatePath = this.templateService.findTemplate('template');
            } catch (e3) {
              templatePath = this.templateService.findTemplate(null);
            }
          }
        }

        const pdfBuffer = await this.pdfService.generatePDF(
          jsonData,
          templatePath,
        );

        const fileName = `nota_credito_${payload.claveAcceso}.pdf`;
        const filePath = join(STORAGE_PATHS.pdfsOthers, fileName);
        writeFileSync(filePath, pdfBuffer);

        const publicUrl = this.configService.get<string>('publicUrl')!;
        payload.pdfUrl = `${publicUrl}/pdfs/others/${fileName}`;
        this.logger.log(`RIDE PDF generado y guardado en: ${payload.pdfUrl}`);
      } catch (error: any) {
        this.logger.error(
          `Error generando RIDE PDF para ${payload.claveAcceso}: ${error.message}`,
        );
      }
    }

    await this.emit('comprobante.autorizado', payload, payload.emisorId);
  }

  /**
   * Obtiene todos los datos relacionados con un comprobante (factura) y los formatea
   * para que coincidan con la estructura esperada por la plantilla de Carbone (factura.html)
   */
  async getCarboneDataForFactura(claveAcceso: string): Promise<any> {
    const comprobante = await this.db.queryOne<any>(
      `SELECT 
        c.*,
        e.ruc as ruc_emisor,
        e.razon_social as razon_social_emisor,
        e.nombre_comercial as nombre_comercial_emisor,
        e.direccion_matriz as dir_matriz_emisor,
        e.obligado_contabilidad as obliged_contabilidad_emisor,
        est.codigo as establecimiento,
        pe.codigo as punto_emision
      FROM comprobantes c
      LEFT JOIN emisores e ON c.emisor_id = e.id
      LEFT JOIN puntos_emision pe ON c.punto_emision_id = pe.id
      LEFT JOIN establecimientos est ON pe.establecimiento_id = est.id
      WHERE c.clave_acceso = $1`,
      [claveAcceso],
    );

    if (!comprobante) {
      throw new Error(
        `Comprobante con clave de acceso ${claveAcceso} no encontrado`,
      );
    }

    const [detallesResult, pagosResult, totalesResult] = await Promise.all([
      this.db.query<any>(
        `SELECT codigo_principal, descripcion, cantidad, precio_unitario, precio_total_sin_impuesto
         FROM comprobante_detalles
         WHERE comprobante_id = $1
         ORDER BY id ASC`,
        [comprobante.id],
      ),
      this.db.query<any>(
        `SELECT forma_pago, total
         FROM comprobante_pagos
         WHERE comprobante_id = $1`,
        [comprobante.id],
      ),
      this.db.query<any>(
        `SELECT codigo, codigo_porcentaje, base_imponible, valor
         FROM comprobante_totales
         WHERE comprobante_id = $1`,
        [comprobante.id],
      ),
    ]);

    const emisor = {
      ruc: comprobante.ruc_emisor || '',
      razonSocial: comprobante.razon_social_emisor || '',
      nombreComercial:
        comprobante.nombre_comercial_emisor ||
        comprobante.razon_social_emisor ||
        '',
      dirMatriz: comprobante.dir_matriz_emisor || '',
      establecimiento: comprobante.establecimiento || '001',
      puntoEmision: comprobante.punto_emision || '001',
      obligadoContabilidad: comprobante.obliged_contabilidad_emisor
        ? 'SI'
        : 'NO',
    };

    const comprador = {
      razonSocial: comprobante.receptor_razon_social || '',
      identificacion: comprobante.receptor_identificacion || '',
      direccion: comprobante.receptor_direccion || 'S/D',
      telefono: comprobante.receptor_telefono || 'S/D',
      email: comprobante.receptor_email || 'S/D',
    };

    const detalles = detallesResult.rows.map((d: any) => ({
      codigoPrincipal: d.codigo_principal || '',
      descripcion: d.descripcion || '',
      cantidad: parseFloat(d.cantidad) || 0,
      precioUnitario: (parseFloat(d.precio_unitario) || 0).toFixed(2),
      baseImponible: (parseFloat(d.precio_total_sin_impuesto) || 0).toFixed(2),
    }));

    const METODOS_PAGO: Record<string, string> = {
      '01': 'Sin utilización del sistema financiero (Efectivo)',
      '15': 'Compensación de deudas',
      '16': 'Tarjeta de débito',
      '17': 'Dinero electrónico',
      '18': 'Tarjeta de prepago',
      '19': 'Tarjeta de crédito',
      '20': 'Otros con utilización del sistema financiero',
      '21': 'Endoso de títulos',
    };

    const pagos = pagosResult.rows.map((p: any) => ({
      metodo:
        METODOS_PAGO[p.forma_pago] ||
        p.forma_pago ||
        'Otros con utilización del sistema financiero',
      total: (parseFloat(p.total) || 0).toFixed(2),
    }));

    if (pagos.length === 0) {
      pagos.push({
        metodo: 'Otros con utilización del sistema financiero',
        total: (parseFloat(comprobante.importe_total) || 0).toFixed(2),
      });
    }

    let subtotal0Val = 0;
    let subtotalVal = 0;
    let ivaVal = 0;

    for (const row of totalesResult.rows) {
      const base = parseFloat(row.base_imponible) || 0;
      const valor = parseFloat(row.valor) || 0;
      if (row.codigo_porcentaje === '0') {
        subtotal0Val += base;
      } else if (['2', '3', '4', '5'].includes(row.codigo_porcentaje)) {
        subtotalVal += base;
        ivaVal += valor;
      }
    }

    const subtotal0 = subtotal0Val.toFixed(2);
    const subtotal = subtotalVal.toFixed(2);
    const iva = ivaVal.toFixed(2);
    const descuento = (parseFloat(comprobante.total_descuento) || 0).toFixed(2);
    const total = (parseFloat(comprobante.importe_total) || 0).toFixed(2);

    return {
      secuencial: comprobante.secuencial || '',
      fechaEmision: comprobante.fecha_emision || '',
      ambiente: comprobante.ambiente === '2' ? 'PRODUCCIÓN' : 'PRUEBAS',
      claveAcceso: comprobante.clave_acceso || '',
      emisor,
      comprador,
      detalles,
      pagos,
      subtotal0,
      subtotal,
      descuento,
      iva,
      total,
    };
  }

  /**
   * Obtiene todos los datos relacionados con una Nota de Crédito y los formatea
   * para la plantilla de Carbone
   */
  async getCarboneDataForNotaCredito(claveAcceso: string): Promise<any> {
    const comprobante = await this.db.queryOne<any>(
      `SELECT 
        c.*,
        e.ruc as ruc_emisor,
        e.razon_social as razon_social_emisor,
        e.nombre_comercial as nombre_comercial_emisor,
        e.direccion_matriz as dir_matriz_emisor,
        e.obligado_contabilidad as obliged_contabilidad_emisor,
        est.codigo as establecimiento,
        pe.codigo as punto_emision
      FROM comprobantes c
      LEFT JOIN emisores e ON c.emisor_id = e.id
      LEFT JOIN puntos_emision pe ON c.punto_emision_id = pe.id
      LEFT JOIN establecimientos est ON pe.establecimiento_id = est.id
      WHERE c.clave_acceso = $1`,
      [claveAcceso],
    );

    if (!comprobante) {
      throw new Error(
        `Comprobante con clave de acceso ${claveAcceso} no encontrado`,
      );
    }

    const [detallesResult, totalesResult] = await Promise.all([
      this.db.query<any>(
        `SELECT codigo_principal, descripcion, cantidad, precio_unitario, precio_total_sin_impuesto
         FROM comprobante_detalles
         WHERE comprobante_id = $1
         ORDER BY id ASC`,
        [comprobante.id],
      ),
      this.db.query<any>(
        `SELECT codigo, codigo_porcentaje, base_imponible, valor
         FROM comprobante_totales
         WHERE comprobante_id = $1`,
        [comprobante.id],
      ),
    ]);

    const emisor = {
      ruc: comprobante.ruc_emisor || '',
      razonSocial: comprobante.razon_social_emisor || '',
      nombreComercial:
        comprobante.nombre_comercial_emisor ||
        comprobante.razon_social_emisor ||
        '',
      dirMatriz: comprobante.dir_matriz_emisor || '',
      establecimiento: comprobante.establecimiento || '001',
      puntoEmision: comprobante.punto_emision || '001',
      obligadoContabilidad: comprobante.obliged_contabilidad_emisor
        ? 'SI'
        : 'NO',
    };

    const comprador = {
      razonSocial: comprobante.receptor_razon_social || '',
      identificacion: comprobante.receptor_identificacion || '',
      direccion: comprobante.receptor_direccion || 'S/D',
      telefono: comprobante.receptor_telefono || 'S/D',
      email: comprobante.receptor_email || 'S/D',
    };

    const detalles = detallesResult.rows.map((d: any) => ({
      codigoPrincipal: d.codigo_principal || '',
      descripcion: d.descripcion || '',
      cantidad: parseFloat(d.cantidad) || 0,
      precioUnitario: (parseFloat(d.precio_unitario) || 0).toFixed(2),
      baseImponible: (parseFloat(d.precio_total_sin_impuesto) || 0).toFixed(2),
    }));

    let subtotal0Val = 0;
    let subtotalVal = 0;
    let ivaVal = 0;

    for (const row of totalesResult.rows) {
      const base = parseFloat(row.base_imponible) || 0;
      const valor = parseFloat(row.valor) || 0;
      if (row.codigo_porcentaje === '0') {
        subtotal0Val += base;
      } else if (['2', '3', '4', '5'].includes(row.codigo_porcentaje)) {
        subtotalVal += base;
        ivaVal += valor;
      }
    }

    const subtotal0 = subtotal0Val.toFixed(2);
    const subtotal = subtotalVal.toFixed(2);
    const iva = ivaVal.toFixed(2);
    const descuento = (parseFloat(comprobante.total_descuento) || 0).toFixed(2);
    const total = (parseFloat(comprobante.importe_total) || 0).toFixed(2);

    const docModificadoFechaRaw = comprobante.doc_modificado_fecha;
    let docModificadoFecha = '';
    if (docModificadoFechaRaw) {
      const d = new Date(docModificadoFechaRaw);
      const day = String(d.getDate()).padStart(2, '0');
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const year = d.getFullYear();
      docModificadoFecha = `${day}/${month}/${year}`;
    }

    return {
      secuencial: comprobante.secuencial || '',
      fechaEmision: comprobante.fecha_emision || '',
      ambiente: comprobante.ambiente === '2' ? 'PRODUCCIÓN' : 'PRUEBAS',
      claveAcceso: comprobante.clave_acceso || '',
      emisor,
      comprador,
      detalles,
      subtotal0,
      subtotal,
      descuento,
      iva,
      total,
      docModificadoTipo: comprobante.doc_modificado_tipo || '01',
      docModificadoNumero: comprobante.doc_modificado_numero || '',
      docModificadoFecha,
      motivo: comprobante.motivo || 'ANULACION DE TRANSACCION',
      valorModificacion: (parseFloat(comprobante.valor_modificacion || comprobante.importe_total) || 0).toFixed(2),
    };
  }

  @OnEvent('comprobante.rechazado')
  async handleComprobanteRechazado(payload: any) {
    this.logger.log(
      `Evento comprobante.rechazado recibido para ${payload.claveAcceso}`,
    );
    await this.emit('comprobante.rechazado', payload, payload.emisorId);
  }

  // =====================
  // CRUD Operations
  // =====================

  async findAll(emisorId?: string): Promise<WebhookResponseDto[]> {
    let query = `
      SELECT id, nombre, url, eventos, emisor_id, secreto, activo, reintentos_max, tenant_id, created_at, updated_at
      FROM webhook_configs
    `;
    const params: string[] = [];

    if (emisorId) {
      query += ` WHERE emisor_id = $1`;
      params.push(emisorId);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.db.query(query, params);
    return result.rows.map((row: Record<string, unknown>) =>
      this.mapToResponse(row),
    );
  }

  /**
   * Listado filtrado por tenant — previene fuga de datos multi-tenant
   */
  async findAllByTenant(
    tenantId: string,
    emisorId?: string,
  ): Promise<WebhookResponseDto[]> {
    let query = `
      SELECT id, nombre, url, eventos, emisor_id, secreto, activo, reintentos_max, tenant_id, created_at, updated_at
      FROM webhook_configs
      WHERE tenant_id = $1
    `;
    const params: string[] = [tenantId];

    if (emisorId) {
      query += ` AND emisor_id = $2`;
      params.push(emisorId);
    }

    query += ` ORDER BY created_at DESC`;

    const result = await this.db.query(query, params);
    return result.rows.map((row: Record<string, unknown>) =>
      this.mapToResponse(row),
    );
  }

  async findOne(id: string): Promise<WebhookResponseDto> {
    const result = await this.db.query(
      `SELECT id, nombre, url, eventos, emisor_id, secreto, activo, reintentos_max, created_at, updated_at
       FROM webhook_configs
       WHERE id = $1`,
      [id],
    );

    if (result.rows.length === 0) {
      throw new NotFoundException(`Webhook con ID ${id} no encontrado`);
    }

    return this.mapToResponse(result.rows[0]);
  }

  async create(
    dto: CreateWebhookDto,
    tenantId?: string,
  ): Promise<WebhookResponseDto> {
    const secreto = this.generateSecret();

    const result = await this.db.query(
      `INSERT INTO webhook_configs (nombre, url, eventos, emisor_id, secreto, reintentos_max, tenant_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, nombre, url, eventos, emisor_id, secreto, activo, reintentos_max, tenant_id, created_at, updated_at`,
      [
        dto.nombre,
        dto.url,
        dto.eventos,
        dto.emisorId || null,
        secreto,
        dto.reintentosMax || 3,
        tenantId || null,
      ],
    );

    this.logger.log(`Webhook creado: ${dto.nombre} -> ${dto.url}`);
    return this.mapToResponse(result.rows[0]);
  }

  async update(id: string, dto: UpdateWebhookDto): Promise<WebhookResponseDto> {
    await this.findOne(id);

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (dto.nombre !== undefined) {
      updates.push(`nombre = $${paramIndex++}`);
      values.push(dto.nombre);
    }
    if (dto.url !== undefined) {
      updates.push(`url = $${paramIndex++}`);
      values.push(dto.url);
    }
    if (dto.eventos !== undefined) {
      updates.push(`eventos = $${paramIndex++}`);
      values.push(dto.eventos);
    }
    if (dto.activo !== undefined) {
      updates.push(`activo = $${paramIndex++}`);
      values.push(dto.activo);
    }
    if (dto.reintentosMax !== undefined) {
      updates.push(`reintentos_max = $${paramIndex++}`);
      values.push(dto.reintentosMax);
    }

    if (updates.length === 0) {
      return this.findOne(id);
    }

    updates.push(`updated_at = NOW()`);
    values.push(id);

    const result = await this.db.query(
      `UPDATE webhook_configs SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING id, nombre, url, eventos, emisor_id, secreto, activo, reintentos_max, created_at, updated_at`,
      values,
    );

    this.logger.log(`Webhook actualizado: ${id}`);
    return this.mapToResponse(result.rows[0]);
  }

  async delete(id: string): Promise<WebhookResponseDto> {
    const webhook = await this.findOne(id);

    // El recurso existe pero está inactivo — 400, no 404
    if (!webhook.activo) {
      throw new BadRequestException('El webhook ya se encuentra inactivo');
    }

    const result = await this.db.query(
      `UPDATE webhook_configs SET activo = false, updated_at = NOW()
       WHERE id = $1
       RETURNING id, nombre, url, eventos, emisor_id, secreto, activo, reintentos_max, created_at, updated_at`,
      [id],
    );

    this.logger.log(`Webhook inactivado: ${id}`);
    return this.mapToResponse(result.rows[0]);
  }

  async regenerateSecret(id: string): Promise<WebhookResponseDto> {
    await this.findOne(id);
    const newSecret = this.generateSecret();

    const result = await this.db.query(
      `UPDATE webhook_configs SET secreto = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, nombre, url, eventos, emisor_id, secreto, activo, reintentos_max, created_at, updated_at`,
      [newSecret, id],
    );

    this.logger.log(`Secreto regenerado para webhook: ${id}`);
    return this.mapToResponse(result.rows[0]);
  }

  // Paginación completa para logs de webhooks
  async getLogs(
    id: string,
    page = 1,
    limit = 50,
  ): Promise<{
    data: WebhookLogResponseDto[];
    total: number;
    page: number;
    totalPages: number;
  }> {
    await this.findOne(id);

    if (limit > 100) limit = 100; // tope máximo para evitar queries pesados
    const offset = (page - 1) * limit;

    const [countResult, dataResult] = await Promise.all([
      this.db.query(`SELECT COUNT(*) FROM webhook_logs WHERE config_id = $1`, [
        id,
      ]),
      this.db.query(
        `SELECT id, evento, payload, status_code, respuesta, intento, exitoso, error, tiempo_respuesta_ms, created_at
         FROM webhook_logs
         WHERE config_id = $1
         ORDER BY created_at DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      ),
    ]);

    const total = parseInt(countResult.rows[0].count, 10);
    const totalPages = Math.ceil(total / limit);

    return {
      data: dataResult.rows.map((row: any) => this.mapLogToResponse(row)),
      total,
      page,
      totalPages,
    };
  }

  // =====================
  // Event Dispatching (BullMQ-based)
  // =====================

  /**
   * Despacha webhooks a la cola BullMQ en vez de usar setTimeout.
   * BullMQ gestiona reintentos con backoff exponencial nativo.
   */
  async emit(
    evento: WebhookEvent,
    payload: Record<string, unknown>,
    emisorId?: string,
  ): Promise<void> {
    // Buscar webhooks suscritos a este evento
    let query = `
      SELECT id, url, secreto, reintentos_max
      FROM webhook_configs
      WHERE activo = true AND $1 = ANY(eventos)
    `;
    const params: (string | undefined)[] = [evento];

    if (emisorId) {
      query += ` AND (emisor_id IS NULL OR emisor_id = $2)`;
      params.push(emisorId);
    }

    const configs = await this.db.query(query, params);

    if (configs.rows.length === 0) {
      return; // No hay webhooks suscritos
    }

    this.logger.log(
      `Encolando evento ${evento} a ${configs.rows.length} webhook(s)`,
    );

    // Encolar cada webhook como job de BullMQ
    for (const config of configs.rows) {
      const jobData: WebhookJobData = {
        configId: config.id as string,
        url: config.url as string,
        secreto: config.secreto as string,
        evento,
        payload,
      };

      await this.webhookQueue.add(`webhook-${evento}`, jobData, {
        attempts: (config.reintentos_max as number) || 5,
        backoff: {
          type: 'exponential',
          delay: 3000,
        },
      });
    }
  }

  // =====================
  // Helpers
  // =====================

  private generateSecret(): string {
    const crypto = require('crypto') as typeof import('crypto');
    return 'whsec_' + crypto.randomBytes(24).toString('hex');
  }

  private mapToResponse(row: Record<string, unknown>): WebhookResponseDto {
    return {
      id: row.id as string,
      nombre: row.nombre as string,
      url: row.url as string,
      eventos: row.eventos as string[],
      emisorId: row.emisor_id as string,
      secreto: row.secreto as string,
      activo: row.activo as boolean,
      reintentosMax: row.reintentos_max as number,
      createdAt: (row.created_at as Date)?.toISOString(),
      updatedAt: (row.updated_at as Date)?.toISOString(),
    };
  }

  private mapLogToResponse(
    row: Record<string, unknown>,
  ): WebhookLogResponseDto {
    return {
      id: row.id as string,
      evento: row.evento as string,
      payload: row.payload,
      statusCode: row.status_code as number,
      respuesta: row.respuesta as string,
      intento: row.intento as number,
      exitoso: row.exitoso as boolean,
      error: row.error as string,
      tiempoRespuestaMs: row.tiempo_respuesta_ms as number,
      createdAt: (row.created_at as Date)?.toISOString(),
    };
  }
}
