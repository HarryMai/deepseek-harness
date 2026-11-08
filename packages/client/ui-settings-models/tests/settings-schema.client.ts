import { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import { SettingsSchemaService } from '@deepseek-ai/dsh-client-ui-settings/src/client/schema.ts'
import { createSettingsSchemaOperations } from '../src/client/schema-operations.ts'

/** Request compatibility fields, including one option outside the curated controls. */
export const requestCompatibilitySchema = Schema.object({
  supportsDeveloperRole: Schema.boolean(),
  maxTokensField: Schema.union(['max_completion_tokens', 'max_tokens']),
  supportsStore: Schema.boolean(),
})

/** Stateless schema operations used by settings-model component fixtures. */
export const settingsSchema = createSettingsSchemaOperations(new SettingsSchemaService(new Context()))
