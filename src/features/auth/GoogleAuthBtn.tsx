"use client";

// import { useGoogleLogin } from "@react-oauth/google";
// import Cookies from "js-cookie";
// import { Button } from "../../../components/ui/button";
import { FcGoogle } from "react-icons/fc";
// import { useRouter } from "next/navigation";
import { Button } from "../../components/ui/button";
// import { useToast } from "../../../hooks/useToast";
// import { authRoutes, overviewRoutes } from "../../../config/routes";
// import { axiosInstance } from "../../../config/axios";

export default function GoogleAuthBtn() {
  // const router = useRouter();
  // const toast = useToast();

  // const login = useGoogleLogin({
  //   scope: "openid email profile",
  //   onSuccess: async (tokenResponse) => {
  //     try {
  //       const userInfoRes = await fetch(
  //         "https://www.googleapis.com/oauth2/v3/userinfo",
  //         {
  //           headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
  //         },
  //       );
  //       const user = await userInfoRes.json(); // has `email` and `sub`

  //       // console.log(user);

  //       const res = await axiosInstance.post("/auth/social", {
  //         email: user.email,
  //         provider_id: user.sub, // Google unique user id
  //       });

  //       const data = res.data;
  //       const expiryDate = new Date(data.data.expires_in * 1000);

  //       Cookies.set("access_token", data.data.access_token, {
  //         expires: expiryDate,
  //         secure: process.env.NODE_ENV === "production",
  //         sameSite: "Lax",
  //         path: "/",
  //       });

  //       // console.log("Google auth successful, token stored in cookie", data.data.profile_complete);

  //       toast.success(data.message || "Login Successful");
  //       router.push(
  //         data.data.profile_complete
  //           ? overviewRoutes.OVERVIEW
  //           : authRoutes.COMPLETE_PROFILE,
  //       );
  //     } catch (e: any) {
  //       toast.error(
  //         e?.response?.data?.message || "Google authentication failed",
  //       );
  //     }
  //   },
  //   onError: () => toast.error("Google authentication failed"),
  // });

  return (
    <Button
      // onClick={() => login()}
      type="button"
      className="w-full bg-[#f5f5f5] text-black-500 font-normal hover:bg-neutral-100 "
    >
      <FcGoogle size={22} />
      <span>Continue with Google</span>
    </Button>
  );
}
