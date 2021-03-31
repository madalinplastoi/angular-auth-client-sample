import { HttpBackend, HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { BehaviorSubject, forkJoin, Subject } from 'rxjs';
import { tap } from 'rxjs/operators';
import { api } from '../../../../config.json';

export interface TokenResponse {
  access_token: string;
}

export interface User {
  username: string;
  password: string;
  email: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthService {
  userSubject = new BehaviorSubject<User>(null);

  get user(): User {
    return this.userSubject.getValue();
  }

  get isAuthenticated(): boolean {
    return this.user != null;
  }

  private httpIndependentClient: HttpClient;

  constructor(private http: HttpClient, httpBackend: HttpBackend) {
    this.httpIndependentClient = new HttpClient(httpBackend);
  }

  login(user: Partial<User>) {
    return this.http.post<TokenResponse>(`${api}/auth/login`, user).pipe(
      tap(async (response) => {
        localStorage.setItem('accessToken', response.access_token);

        await this.getProfile().toPromise();
      })
    );
  }

  register(user: Partial<User>) {
    return this.http.post<TokenResponse>(`${api}/auth/register`, user).pipe(
      tap(async (response) => {
        localStorage.setItem('accessToken', response.access_token);

        await this.getProfile().toPromise();
      })
    );
  }

  getProfile() {
    return this.httpIndependentClient.get<User>(`${api}/auth/me`).pipe(
      tap(
        (user) => {
          this.userSubject.next(user);
        },
        () => this.userSubject.next(null)
      )
    );
  }

  logout() {
    localStorage.clear();

    this.userSubject.next(null);
  }
}
