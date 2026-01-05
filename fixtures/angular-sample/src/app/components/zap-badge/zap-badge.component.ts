import { Component, Input } from '@angular/core';

@Component({
  selector: 'zap-badge',
  templateUrl: './zap-badge.component.html',
})
export class ZapBadgeComponent {
  @Input() label = 'Badge';
  @Input() variant: 'info' | 'success' | 'warning' | 'danger' = 'info';
  @Input() rounded = false;
}
