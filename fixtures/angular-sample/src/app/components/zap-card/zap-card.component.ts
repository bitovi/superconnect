import { Component, Input } from '@angular/core';

@Component({
  selector: 'zap-card',
  templateUrl: './zap-card.component.html',
})
export class ZapCardComponent {
  @Input() heading = '';
  @Input() elevated = false;
}
