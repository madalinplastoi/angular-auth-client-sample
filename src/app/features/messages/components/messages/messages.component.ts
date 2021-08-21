import {
  ChangeDetectorRef,
  Component,
  ElementRef,
  Input,
  OnDestroy,
  OnInit,
  ViewChild,
} from '@angular/core';
import { FormBuilder } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { boundMethod } from 'autobind-decorator';
import { remove } from 'lodash';
import { Subject, timer } from 'rxjs';
import { filter, take, takeUntil } from 'rxjs/operators';
import { Sound, SoundService } from 'src/app/shared/services/sound.service';
import { HttpError } from '../../../../core/interceptor/error-dialog.interceptor';
import { MainSocket } from '../../../../core/socket/main-socket';
import { ConfirmDialogComponent } from '../../../../shared/components/confirm-dialog/confirm-dialog.component';
import { AuthService, User } from '../../../auth/service/auth.service';
import { Room } from '../../../room/service/room.service';
import { Message, MessageService } from '../../service/message.service';

export enum MessageType {
  Direct = 'direct',
  Room = 'room',
}

@Component({
  selector: 'app-messages',
  templateUrl: './messages.component.html',
  styleUrls: ['./messages.component.scss'],
})
export class MessagesComponent implements OnInit, OnDestroy {
  @Input() type: MessageType;
  @Input() room?: Room;
  @Input() to?: User;
  @Input() updateMessages$: Subject<void>;
  @Input() messages: Message[] = [];

  @ViewChild('messagesContainer') messagesContainer: ElementRef<HTMLDivElement>;

  messageForm = this.formBuilder.group({
    message: '',
  });

  isConnected = false;

  get messagesElement() {
    return this.messagesContainer.nativeElement;
  }

  destroy$ = new Subject();
  MessageType = MessageType;
  user: User;
  firstMessage: Message;

  private readonly limit = 30;

  private readonly scrollOffset = 200;

  scrolledToLast = false;

  constructor(
    private messageService: MessageService,
    private socket: MainSocket,
    private formBuilder: FormBuilder,
    private soundService: SoundService,
    private authService: AuthService,
    private dialog: MatDialog,
    private changeDetector: ChangeDetectorRef,
  ) {}

  get partnerId() {
    switch (this.type) {
      case MessageType.Room:
        return this.room._id;
      case MessageType.Direct:
        return this.to._id;
      default:
        return undefined;
    }
  }

  ngOnInit(): void {
    this.socket.connect();

    this.socket
      .onConnect()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => {
        this.isConnected = true;

        if (!this.updateMessages$) {
          this.getMessages();
        }
      });

    this.socket
      .onDisconnect()
      .pipe(takeUntil(this.destroy$))
      .subscribe(() => (this.isConnected = false));

    this.authService.user$
      .pipe(takeUntil(this.destroy$))
      .subscribe(user => (this.user = user));

    this.updateMessages$
      ?.pipe(takeUntil(this.destroy$))
      .subscribe(this.getMessages);

    this.messageService
      .getMessage(this.type)
      .pipe(
        takeUntil(this.destroy$),
        filter(
          message =>
            this.isCurrentSection(
              message.to !== this.user._id ? message.to : message.from._id,
              message.room,
            ) && !this.messages.some(msg => msg._id === message._id),
        ),
      )
      .subscribe(this.handleMessageEvent);

    this.messageService
      .onDeleteMessagesEvent(this.type)
      .pipe(
        takeUntil(this.destroy$),
        filter(object => this.isCurrentSection(object._id)),
      )
      .subscribe(() => remove(this.messages, () => true));

    this.messageService
      .onDeleteMessageEvent(this.type)
      .pipe(takeUntil(this.destroy$))
      .subscribe(messageId =>
        remove(this.messages, message => message._id === messageId),
      );

    this.messageService
      .getFirstMessage(this.type, this.partnerId)
      .pipe(take(1))
      .subscribe(message => (this.firstMessage = message));
  }

  ngOnDestroy() {
    this.socket.disconnect();

    this.destroy$.next();
    this.destroy$.complete();
  }

  @boundMethod
  getMessages() {
    this.messageService
      .getMessages(this.type, this.partnerId, this.limit)
      .pipe(take(1))
      .subscribe(messages => {
        remove(this.messages, () => true);
        this.messages.push(...messages);

        this.scrollToLastMessages();
      });
  }

  getPreviousMessages() {
    if (this.messages[0]?._id === this.firstMessage?._id) {
      return;
    }

    console.log(this.messages[0].createdAt);
    this.messageService
      .getMessages(
        this.type,
        this.partnerId,
        this.limit,
        this.messages[0].createdAt,
      )
      .subscribe(messages => {
        this.messages.splice(0, 0, ...messages);
      });
  }

  @boundMethod
  handleMessageEvent(message: Message) {
    this.messages.push(message);

    if (message.from._id !== this.user._id) {
      this.soundService.playSound(Sound.Message);
    }

    this.scrollToLastIfNecessary();

    return;
  }

  isCurrentSection(...objectIds: string[]) {
    return objectIds.some(
      id =>
        (this.room && this.room._id === id) ||
        (this.to && this.to._id === id) ||
        this.user._id === id,
    );
  }

  scrollToLastIfNecessary() {
    const element = this.messagesElement;

    if (
      element.scrollTop >
      element.scrollHeight - element.offsetHeight - this.scrollOffset
    ) {
      this.scrolledToLast = false;

      this.scrollToLastMessages();
    }
  }

  scrollToLastMessages() {
    this.changeDetector.detectChanges();

    this.messagesElement.scrollTo({
      top: this.messagesElement.scrollHeight,
      behavior: 'smooth',
    });

    timer(1000).subscribe(() => (this.scrolledToLast = true));
  }

  sendMessage() {
    const message = this.messageForm.value.message;

    if (!message?.trim()) {
      return;
    }

    if (!this.isConnected) {
      this.handleMessageCallback();
    }

    switch (this.type) {
      case MessageType.Room:
        this.messageService.sendRoomMessage(
          this.room,
          message,
          this.handleMessageCallback,
        );
        break;
      case MessageType.Direct:
        this.messageService.sendDirectMessage(
          this.to,
          message,
          this.handleMessageCallback,
        );
        break;
      default:
        break;
    }
  }

  @boundMethod
  handleMessageCallback(response?: boolean | HttpError) {
    if (typeof response !== 'object') {
      this.messageForm.patchValue({
        message: '',
      });
    }
  }

  onScroll(e: Event) {
    if (!this.scrolledToLast) {
      return;
    }

    const element = e.target as HTMLDivElement;

    if (element.scrollTop <= 5) {
      this.getPreviousMessages();
    }
  }

  confirmDeleteMessage(message: Message) {
    const dialog = this.dialog.open(ConfirmDialogComponent);

    dialog
      .afterClosed()
      .pipe(take(1))
      .subscribe(confirm => {
        if (confirm) {
          this.deleteMessage(message);
        }
      });
  }

  deleteMessage(message: Message) {
    this.messageService
      .deleteMessage(this.type, message)
      .pipe(take(1))
      .subscribe();
  }
}
