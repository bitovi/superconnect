import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'zap-toggle',
  templateUrl: './zap-toggle.component.html',
})
export class ZapToggleComponent {
  @Input() label = 'Toggle';
  @Input() checked = false;
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Input() disabled = false;
  @Output() toggled = new EventEmitter<boolean>();

  onToggle() {
    if (this.disabled) return;
    this.checked = !this.checked;
    this.toggled.emit(this.checked);
  }
}
