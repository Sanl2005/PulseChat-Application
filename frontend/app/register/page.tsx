"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterPage() {

    const router = useRouter();

    const [displayName, setDisplayName] =
        useState("");

    const [username, setUsername] =
        useState("");

    const [phoneNumber, setPhoneNumber] =
        useState("");

    const [password, setPassword] =
        useState("");

    const [error, setError] =
        useState("");

    const [loading, setLoading] =
        useState(false);


    const register = async (e: React.FormEvent<HTMLFormElement>) => {

        e.preventDefault();

        setError("");
        setLoading(true);

        try {

            const response =
                await fetch(
                    "http://localhost:5000/api/auth/register",
                    {
                        method: "POST",

                        headers: {
                            "Content-Type":
                                "application/json"
                        },

                        body: JSON.stringify({
                            username,
                            displayName,
                            phoneNumber,
                            password
                        })
                    }
                );

            const data =
                await response.json();

            if (!response.ok) {

                setError(
                    data.error ||
                    "Registration failed"
                );

                return;

            }

            /*
             * Registration successful.
             *
             * Later this will redirect
             * to OTP verification.
             */

            router.push("/login");

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
                    <h1>Start your next conversation.</h1>
                    <p>Create an account to find people, create groups, and stay connected.</p>
                </div>
                <div className="showcase-footer">PulseChat · Simple, secure messaging</div>
            </section>

            <section className="auth-panel">
            <div className="auth-card">

                <div className="auth-card-brand"><span className="brand-mark">P</span> PulseChat</div>

                <p className="eyebrow">CREATE ACCOUNT</p>
                <h1>Join PulseChat</h1>
                <p className="auth-subtitle">Set up your profile in less than a minute.</p>

                <form
                    onSubmit={register}
                >

                    <div className="auth-field">
                        <label htmlFor="display-name">Display name</label>
                        <input
                            id="display-name"
                            type="text"
                            placeholder="How people will see you"
                            value={displayName}
                            onChange={e => setDisplayName(e.target.value)}
                            autoComplete="name"
                            required
                        />
                    </div>

                    <div className="auth-field">
                        <label htmlFor="username">Username</label>
                        <input
                            id="username"
                            type="text"
                            placeholder="Choose a unique username"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            autoComplete="username"
                            minLength={3}
                            maxLength={100}
                            required
                        />
                    </div>

                    <div className="auth-field">
                        <label htmlFor="phone-number">Phone number</label>
                        <input
                            id="phone-number"
                            type="tel"
                            placeholder="+91 9876543210"
                            value={phoneNumber}
                            onChange={e => setPhoneNumber(e.target.value)}
                            autoComplete="tel"
                            required
                        />
                    </div>

                    <div className="auth-field">
                        <label htmlFor="register-password">Password</label>
                        <input
                            id="register-password"
                            type="password"
                            placeholder="At least 8 characters"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            autoComplete="new-password"
                            minLength={8}
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
                            ? "Creating..."
                            : "Create Account"}
                    </button>

                </form>

                <p className="auth-switch">
                    Already have an account? <button
                    className="link-button"
                    type="button"
                    onClick={() =>
                        router.push("/login")
                    }
                >
                    Login
                    </button>
                </p>

            </div>
            </section>

        </main>

    );

}
