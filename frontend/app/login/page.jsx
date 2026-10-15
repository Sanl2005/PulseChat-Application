"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {

    const router = useRouter();

    const [identifier, setIdentifier] =
        useState("");

    const [password, setPassword] =
        useState("");

    const [error, setError] =
        useState("");

    const [loading, setLoading] =
        useState(false);


    const login = async (e) => {

        e.preventDefault();

        setError("");
        setLoading(true);

        try {

            const response =
                await fetch(
                    "http://localhost:5000/api/auth/login",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            identifier,
                            password
                        })
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {

                setError(
                    data.error ||
                    "Login failed"
                );

                return;

            }

            /*
             * Store authentication information.
             */

            localStorage.setItem(
                "pulsechat_token",
                data.token
            );

            localStorage.setItem(
                "pulsechat_user",
                JSON.stringify(
                    data.user
                )
            );

            router.replace("/");

        } catch (error) {

            console.error(error);

            setError(
                "Unable to connect to server"
            );

        } finally {

            setLoading(false);

        }

    };


    return (

        <main className="auth-page">
            <section className="auth-showcase" aria-label="PulseChat introduction">
                <div className="showcase-brand">
                    <span className="brand-mark">P</span>
                    <span>PulseChat</span>
                </div>
                <div className="showcase-copy">
                    <p className="eyebrow">SMART COMMUNICATION</p>
                    <h1>Every conversation, right in sync.</h1>
                    <p>Connect with the people who matter in one focused, private workspace.</p>
                </div>
                <div className="showcase-footer">PulseChat · Simple, secure messaging</div>
            </section>

            <section className="auth-panel">
            <div className="auth-card">

                <div className="auth-card-brand"><span className="brand-mark">P</span> PulseChat</div>

                <p className="eyebrow">WELCOME BACK</p>
                <h1>Sign in to your account</h1>
                <p className="auth-subtitle">Enter your details to continue chatting.</p>

                <form
                    onSubmit={login}
                >

                    <div className="auth-field">
                        <label htmlFor="login-identifier">Username or phone number</label>
                        <input
                            id="login-identifier"
                            type="text"
                            placeholder="Enter your username or password"
                            value={identifier}
                            onChange={e => setIdentifier(e.target.value)}
                            autoComplete="username"
                            required
                        />
                    </div>

                    <div className="auth-field">
                        <label htmlFor="login-password">Password</label>
                        <input
                            id="login-password"
                            type="password"
                            placeholder="Enter your password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            autoComplete="current-password"
                            required
                        />
                    </div>

                    {error && (
                        <p className="error">
                            {error}
                        </p>
                    )}

                    <button className="auth-submit"
                        type="submit"
                        disabled={loading}
                    >
                        {loading
                            ? "Signing in..."
                            : "Login"}
                    </button>

                </form>

                <p className="auth-switch">
                    New to PulseChat? <button
                    className="link-button"
                    type="button"
                    onClick={() =>
                        router.push("/register")
                    }
                >
                    Create an account
                    </button>
                </p>

            </div>
            </section>

        </main>

    );

}
