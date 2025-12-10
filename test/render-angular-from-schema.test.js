const { renderAngularFromSchema } = require('../src/angular/render-angular');

describe('renderAngularFromSchema', () => {
  const baseSchema = {
    selector: 'zap-button',
    inputs: {
      disabled: { type: 'boolean' },
      variant: { type: 'enum', values: ['default', 'primary'] },
      checked: { type: 'boolean' }
    },
    example_template:
      "<zap-button [disabled]=\"'false'\" [variant]=\"'default'\">Submit</zap-button>"
  };

  it('normalizes boolean bindings to use actual boolean values', () => {
    const output = renderAngularFromSchema(baseSchema, 'token', 'zap-button', []);
    expect(output).toEqual(expect.stringContaining('[disabled]="false"'));
    expect(output).not.toEqual(expect.stringContaining("[disabled]=\"'false'\""));
  });

  it('simplifies static string bindings to plain attributes', () => {
    const output = renderAngularFromSchema(baseSchema, 'token', 'zap-button', []);
    expect(output).toEqual(expect.stringContaining('variant="default"'));
    expect(output).not.toEqual(expect.stringContaining("[variant]=\"'default'\""));
  });

  it('downgrades two-way boolean bindings to one-way with a default true value', () => {
    const schema = {
      ...baseSchema,
      example_template:
        "<zap-checkbox [(checked)]=\"isChecked\" [label]=\"'Accept'\" [variant]=\"'default'\"></zap-checkbox>"
    };
    const output = renderAngularFromSchema(schema, 'token', 'zap-checkbox', []);
    expect(output).toEqual(expect.stringContaining('[checked]="true"'));
    expect(output).not.toEqual(expect.stringContaining('[(checked)]'));
  });

  it('normalizes event handlers to generic placeholders', () => {
    const schema = {
      ...baseSchema,
      example_template:
        '<zap-chip text="Chip" type="info" (dismiss)="onDismiss()"></zap-chip>'
    };
    const output = renderAngularFromSchema(schema, 'token', 'zap-chip', []);
    expect(output).toEqual(expect.stringContaining('(dismiss)="handleDismiss()"'));
    expect(output).not.toEqual(expect.stringContaining('onDismiss'));
  });

  it('keeps multiple events and normalizes handler names', () => {
    const schema = {
      ...baseSchema,
      example_template:
        '<zap-dialog (confirm)="onConfirm()" (close)="onClose()" title="Confirm"></zap-dialog>'
    };
    const output = renderAngularFromSchema(schema, 'token', 'zap-dialog', []);
    expect(output).toEqual(expect.stringContaining('(confirm)="handleConfirm()"'));
    expect(output).toEqual(expect.stringContaining('(close)="handleClose()"'));
  });
});
